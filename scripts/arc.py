#!/usr/bin/env python3
"""arc.py — self-contained ARC IaC toolkit.

Stdlib only — no pip installs. Python 3.8+.

Commands:
  list [--sort downloads|name]
  search <query>
  get <name> [--readme]
  inputs <name>
  outputs <name>
  resources <name>
  versions <name>
  find-by-resource <aws_resource_type>
  compare <module_a> <module_b>
  scaffold <name> [--instance NAME] [--out DIR]
  scan (--file PATH | --stdin)
  validate <name> [--instance NAME] [--out DIR]

All module arguments use the SHORT name: arc-eks, not terraform-aws-arc-eks.
"""
import argparse
import concurrent.futures
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://registry.terraform.io/v1"
NS = "sourcefuse"
SCAN_SERVICE_URL = os.environ.get(
    "SCAN_SERVICE_URL",
    "https://arc-iac-scan-service-173261605830.us-central1.run.app",
)


def _ssl_context():
    """Build an SSL context that works even on macOS Pythons missing system certs.

    Prefer certifi's CA bundle if installed; fall back to the default. Set
    ARC_INSECURE=1 to disable verification entirely (last resort for broken
    corporate TLS interception — not recommended).
    """
    if os.environ.get("ARC_INSECURE") == "1":
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_SSL = _ssl_context()


# ── Registry client ───────────────────────────────────────────────────────────


def _get(path):
    url = f"{BASE}{path}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "arc-iac-skill/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20, context=_SSL) as res:
        return json.loads(res.read().decode())


def normalize_name(name):
    """Accept full paths/underscore forms, return the short hyphenated name."""
    n = name.strip()
    # sourcefuse/arc-network/aws  -> arc-network
    if "/" in n:
        parts = [p for p in n.split("/") if p]
        # find the segment that looks like a module name
        for p in parts:
            if p not in (NS, "aws"):
                n = p
                break
    n = n.replace("terraform-aws-", "")
    n = n.replace("_", "-")
    return n


def list_all_modules():
    all_mods, offset = [], 0
    while True:
        data = _get(f"/modules?namespace={NS}&limit=100&offset={offset}")
        mods = data.get("modules", [])
        all_mods.extend(mods)
        nxt = (data.get("meta") or {}).get("next_offset")
        if not nxt or not mods:
            break
        offset = nxt
    return all_mods


def search_modules(q):
    data = _get(f"/modules?namespace={NS}&q={urllib.parse.quote(q)}&limit=50")
    return data.get("modules", [])


def get_module_raw(name):
    """Module detail without the versions list (1 request)."""
    return _get(f"/modules/{NS}/{name}/aws")


def _semver_key(v):
    """Sort key for a version string. Pre-release (e.g. 1.0.0-rc1) sorts below
    its release. Non-numeric segments fall back to 0 so odd tags don't crash."""
    core, _, _pre = v.partition("-")
    parts = []
    for seg in core.split("."):
        parts.append(int(seg) if seg.isdigit() else 0)
    while len(parts) < 3:
        parts.append(0)
    return (parts, 0 if _pre else 1)  # release ranks above pre-release


def get_versions(name):
    data = _get(f"/modules/{NS}/{name}/aws/versions")
    mods = data.get("modules") or [{}]
    vers = [v["version"] for v in (mods[0].get("versions") or [])]
    # Registry returns ascending; sort descending so index 0 is the real latest.
    return sorted(vers, key=_semver_key, reverse=True)


def get_module(name):
    """Full detail including versions (2 requests), matching the MCP tool."""
    mod = get_module_raw(name)
    mod["versions"] = get_versions(name)
    return mod


def root_of(mod):
    return mod.get("root") or {}


# ── Scaffold logic (ported from src/scaffold.ts) ────────────────────────────────

# Each rule: (compiled pattern, keys, ref-string)
DATA_RULES = [
    (re.compile(r"^vpc_id$"), ["vpc"], "data.aws_vpc.this.id"),
    (
        re.compile(r"^subnet_ids?$"),
        ["vpc", "subnets"],
        "data.aws_subnets.private.ids",
    ),
    (
        re.compile(r"^vpc_config$"),
        ["vpc", "subnets"],
        "{\n    subnet_ids         = data.aws_subnets.private.ids\n"
        "    security_group_ids = [data.aws_security_group.this.id]\n  }",
    ),
    (
        re.compile(r"^db_subnet_group_data$"),
        ["vpc", "subnets"],
        "{\n    name       = \"${local.name_prefix}-db-subnet-group\"\n"
        "    subnet_ids = data.aws_subnets.private.ids\n  }",
    ),
    (
        re.compile(r"^kms_key_id$|^kms_arn$|^kms_key_arn$"),
        ["kms"],
        "data.aws_kms_alias.this.target_key_arn",
    ),
    (
        re.compile(r"^kms_data$"),
        ["kms"],
        "{ key_id = data.aws_kms_alias.this.target_key_id, "
        "key_arn = data.aws_kms_alias.this.target_key_arn }",
    ),
    (
        re.compile(r"^security_group_ids?$"),
        ["sg"],
        "[data.aws_security_group.this.id]",
    ),
    (re.compile(r"^tags$"), [], "local.tags"),
]

DATA_SOURCE_VARS = {
    "vpc": [
        ("vpc_name", "Name tag of the existing VPC to look up.", "string")
    ],
    "subnets": [
        (
            "subnet_tier_tag",
            'Value of the "Tier" tag on the private subnets (e.g. "private").',
            "string",
        )
    ],
    "kms": [
        ("kms_alias", 'KMS key alias without the "alias/" prefix.', "string")
    ],
    "sg": [
        (
            "security_group_name",
            "Name tag of the existing security group to look up.",
            "string",
        )
    ],
}

DATA_KEY_ORDER = ["vpc", "subnets", "kms", "sg"]


def detect_data_sources(inputs):
    needed = set()
    for inp in [i for i in inputs if i.get("required")]:
        for pattern, keys, _ref in DATA_RULES:
            if pattern.match(inp["name"]):
                needed.update(keys)
    return needed


def ref_for_input(name, needed):
    for pattern, keys, ref in DATA_RULES:
        if pattern.match(name):
            if len(keys) == 0 or all(k in needed for k in keys):
                return ref
    return None


def tf_type(hcl_type):
    t = (hcl_type or "").lower().strip()
    if t.startswith("list"):
        return "list(string)"
    if t.startswith("map"):
        return "map(string)"
    if t.startswith("object") or t.startswith("set"):
        return "any"
    if t in ("bool", "boolean"):
        return "bool"
    if t == "number":
        return "number"
    return "string"


def build_version_tf(mod):
    resources = root_of(mod).get("resources") or []
    needs_helm = any(r["type"].startswith("helm_") for r in resources)
    needs_k8s = any(r["type"].startswith("kubernetes_") for r in resources)
    lines = [
        "terraform {",
        '  required_version = ">= 1.3.0"',
        "",
        "  required_providers {",
        "    aws = {",
        '      source  = "hashicorp/aws"',
        '      version = ">= 5.0"',
        "    }",
    ]
    if needs_helm:
        lines += [
            "    helm = {",
            '      source  = "hashicorp/helm"',
            '      version = ">= 2.0"',
            "    }",
        ]
    if needs_k8s:
        lines += [
            "    kubernetes = {",
            '      source  = "hashicorp/kubernetes"',
            '      version = ">= 2.0"',
            "    }",
        ]
    lines += ["  }", "}"]
    return "\n".join(lines)


def _var_block(name, description, vtype):
    return (
        f'variable "{name}" {{\n'
        f"  description = {json.dumps(description)}\n"
        f"  type        = {vtype}\n}}"
    )


def build_variables_tf(mod, needed):
    blocks, seen = [], set()
    common = [
        ("environment", "Deployment environment (e.g. prod, staging, dev).", "string"),
        (
            "namespace",
            "Project or team namespace used as a resource name prefix.",
            "string",
        ),
        ("region", "AWS region to deploy into.", "string"),
    ]
    for name, desc, vtype in common:
        seen.add(name)
        blocks.append(_var_block(name, desc, vtype))

    for key in DATA_KEY_ORDER:
        if key not in needed:
            continue
        for name, desc, vtype in DATA_SOURCE_VARS[key]:
            if name in seen:
                continue
            seen.add(name)
            blocks.append(_var_block(name, desc, vtype))

    for inp in [i for i in (root_of(mod).get("inputs") or []) if i.get("required")]:
        if ref_for_input(inp["name"], needed) or inp["name"] in seen:
            continue
        seen.add(inp["name"])
        blocks.append(
            _var_block(
                inp["name"],
                inp.get("description") or inp["name"],
                tf_type(inp.get("type", "")),
            )
        )
    return "\n\n".join(blocks)


def build_locals_tf():
    return "\n".join(
        [
            "locals {",
            '  name_prefix = "${var.namespace}-${var.environment}"',
            "",
            "  tags = {",
            "    Environment = var.environment",
            "    Namespace   = var.namespace",
            '    ManagedBy   = "terraform"',
            "  }",
            "}",
        ]
    )


def build_data_tf(needed):
    blocks = []
    if "vpc" in needed:
        blocks.append(
            'data "aws_vpc" "this" {\n  tags = {\n    Name = var.vpc_name\n  }\n}'
        )
    if "subnets" in needed:
        blocks.append(
            'data "aws_subnets" "private" {\n  filter {\n'
            '    name   = "vpc-id"\n    values = [data.aws_vpc.this.id]\n  }\n\n'
            "  tags = {\n    Tier = var.subnet_tier_tag\n  }\n}"
        )
    if "kms" in needed:
        blocks.append(
            'data "aws_kms_alias" "this" {\n  name = "alias/${var.kms_alias}"\n}'
        )
    if "sg" in needed:
        blocks.append(
            'data "aws_security_group" "this" {\n  vpc_id = data.aws_vpc.this.id\n\n'
            "  tags = {\n    Name = var.security_group_name\n  }\n}"
        )
    return "\n\n".join(blocks)


def build_main_tf(mod, instance_name, needed):
    inputs = root_of(mod).get("inputs") or []
    required = [i for i in inputs if i.get("required")]
    optional = [i for i in inputs if not i.get("required")]
    lines = [
        f'module "{instance_name}" {{',
        f'  source  = "sourcefuse/{mod["name"]}/aws"',
        f'  version = "{mod["version"]}"',
        "",
    ]
    if required:
        lines.append("  # --- required ---")
        for i in required:
            ref = ref_for_input(i["name"], needed)
            lines.append(
                f'  {i["name"]} = {ref}' if ref else f'  {i["name"]} = var.{i["name"]}'
            )
        lines.append("")
    if optional:
        lines.append("  # --- optional (uncomment to override defaults) ---")
        for i in optional:
            d = i.get("default")
            if d is None:
                val = "null"
            elif isinstance(d, str):
                val = " ".join(d.split())
            else:
                val = json.dumps(d)
            lines.append(f'  # {i["name"]} = {val}')
        lines.append("")
    lines.append("  tags = local.tags")
    lines.append("}")
    return "\n".join(lines)


def build_outputs_tf(mod, instance_name):
    return "\n\n".join(
        "\n".join(
            [
                f'output "{instance_name}_{o["name"]}" {{',
                f'  description = {json.dumps(o.get("description") or o["name"])}',
                f'  value       = module.{instance_name}.{o["name"]}',
                "}",
            ]
        )
        for o in (root_of(mod).get("outputs") or [])
    )


FILE_ORDER = ["main.tf", "variables.tf", "locals.tf", "outputs.tf", "data.tf", "version.tf"]


def generate_scaffold(mod, instance_name="this"):
    needed = detect_data_sources(root_of(mod).get("inputs") or [])
    files = {
        "main.tf": build_main_tf(mod, instance_name, needed),
        "variables.tf": build_variables_tf(mod, needed),
        "locals.tf": build_locals_tf(),
        "version.tf": build_version_tf(mod),
    }
    outputs = build_outputs_tf(mod, instance_name)
    if outputs.strip():
        files["outputs.tf"] = outputs
    data = build_data_tf(needed)
    if data.strip():
        files["data.tf"] = data
    return files


def format_scaffold_files(files):
    ordered = [f for f in FILE_ORDER if f in files] + sorted(
        f for f in files if f not in FILE_ORDER
    )
    return "\n\n".join(f"### {f}\n```hcl\n{files[f]}\n```" for f in ordered)


# ── Security scan (tfsec) ───────────────────────────────────────────────────────


def _scan_local_tfsec(hcl):
    """Run a locally-installed tfsec if present. Returns ScanResult-like dict or None."""
    if not shutil.which("tfsec"):
        return None
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "main.tf"), "w") as f:
            f.write(hcl)
        proc = subprocess.run(
            ["tfsec", d, "-f", "json", "--no-color", "--include-passed"],
            capture_output=True,
            text=True,
        )
        out = proc.stdout.strip()
        if not out:
            return None
        try:
            data = json.loads(out)
        except json.JSONDecodeError:
            return None
        results = data.get("results") or []
        failed, passed = [], []
        for r in results:
            entry = {
                "severity": r.get("severity", ""),
                "rule_id": r.get("long_id") or r.get("rule_id", ""),
                "description": r.get("description", ""),
            }
            (passed if r.get("status") == 1 else failed).append(entry)
        return {"tfsec": failed, "tfsec_passed": passed, "checkov": []}


def _scan_service(hcl):
    body = json.dumps({"hcl": hcl}).encode()
    req = urllib.request.Request(
        f"{SCAN_SERVICE_URL}/scan",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90, context=_SSL) as res:
        return json.loads(res.read().decode())


def scan_hcl(hcl):
    local = _scan_local_tfsec(hcl)
    if local is not None:
        return local
    return _scan_service(hcl)


def format_scan_result(result, label="provided HCL"):
    findings = result.get("tfsec") or []
    passed = result.get("tfsec_passed") or []

    def by_sev(sev):
        return [f for f in findings if (f.get("severity") or "").upper() == sev]

    total = len(findings) + len(passed)
    score = round((len(passed) / total) * 100) if total else 100
    lines = [
        f"## Security Scan — {label}",
        f"**Score: {score}/100** | ✅ {len(passed)} passed | ❌ {len(findings)} failed",
        "",
    ]

    def add_group(label, items):
        if not items:
            return
        lines.append(f"### {label} ({len(items)})")
        for f in items:
            lines.append(f'- **{f.get("rule_id")}**: {f.get("description")}')
        lines.append("")

    if not findings:
        lines.append("🎉 No security issues found.")
    else:
        add_group("🔴 CRITICAL", by_sev("CRITICAL"))
        add_group("🟠 HIGH", by_sev("HIGH"))
        add_group("🟡 MEDIUM", by_sev("MEDIUM"))
        add_group("🔵 LOW", by_sev("LOW"))
    return "\n".join(lines)


# ── Output helpers ──────────────────────────────────────────────────────────────


def emit(data):
    print(data if isinstance(data, str) else json.dumps(data, indent=2))


def write_files(files, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for fname, content in files.items():
        with open(os.path.join(out_dir, fname), "w") as f:
            f.write(content + "\n")
    return sorted(files.keys())


# ── Commands ────────────────────────────────────────────────────────────────────


def cmd_list(a):
    mods = list_all_modules()
    if a.sort == "downloads":
        mods.sort(key=lambda m: m.get("downloads", 0), reverse=True)
    elif a.sort == "name":
        mods.sort(key=lambda m: m.get("name", ""))
    emit(
        [
            {
                "name": m["name"],
                "description": m.get("description", ""),
                "downloads": m.get("downloads", 0),
                "version": m.get("version", ""),
            }
            for m in mods
        ]
    )


def cmd_search(a):
    mods = search_modules(a.query)
    emit(
        [
            {
                "name": m["name"],
                "description": m.get("description", ""),
                "downloads": m.get("downloads", 0),
            }
            for m in mods
        ]
    )


def cmd_get(a):
    mod = get_module(normalize_name(a.name))
    if not a.readme and mod.get("root"):
        mod["root"] = {k: v for k, v in mod["root"].items() if k != "readme"}
    emit(mod)


def cmd_inputs(a):
    emit(root_of(get_module(normalize_name(a.name))).get("inputs") or [])


def cmd_outputs(a):
    emit(root_of(get_module(normalize_name(a.name))).get("outputs") or [])


def cmd_resources(a):
    emit(root_of(get_module(normalize_name(a.name))).get("resources") or [])


def cmd_versions(a):
    vers = get_versions(normalize_name(a.name))
    emit([{"version": v, "latest": i == 0} for i, v in enumerate(vers)])


def cmd_find_by_resource(a):
    target = a.resource.lower()
    mods = list_all_modules()
    matches = []

    def check(m):
        try:
            detail = get_module_raw(m["name"])
            if any(
                r["type"].lower() == target
                for r in (root_of(detail).get("resources") or [])
            ):
                return {
                    "name": m["name"],
                    "description": m.get("description", ""),
                }
        except Exception:
            return None
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for res in ex.map(check, mods):
            if res:
                matches.append(res)
    matches.sort(key=lambda x: x["name"])
    emit(matches)


def cmd_compare(a):
    name_a, name_b = normalize_name(a.module_a), normalize_name(a.module_b)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        fa = ex.submit(get_module, name_a)
        fb = ex.submit(get_module, name_b)
        a_mod, b_mod = fa.result(), fb.result()

    def diff(as_, bs_):
        an = {x["name"] for x in as_}
        bn = {x["name"] for x in bs_}
        return {n: {"in_a": n in an, "in_b": n in bn} for n in sorted(an | bn)}

    emit(
        {
            "module_a": {
                "name": a_mod["name"],
                "version": a_mod["version"],
                "downloads": a_mod.get("downloads", 0),
            },
            "module_b": {
                "name": b_mod["name"],
                "version": b_mod["version"],
                "downloads": b_mod.get("downloads", 0),
            },
            "inputs": diff(
                root_of(a_mod).get("inputs") or [],
                root_of(b_mod).get("inputs") or [],
            ),
            "outputs": diff(
                root_of(a_mod).get("outputs") or [],
                root_of(b_mod).get("outputs") or [],
            ),
            "resources": diff(
                [{"name": r["type"]} for r in (root_of(a_mod).get("resources") or [])],
                [{"name": r["type"]} for r in (root_of(b_mod).get("resources") or [])],
            ),
        }
    )


def cmd_scaffold(a):
    mod = get_module(normalize_name(a.name))
    files = generate_scaffold(mod, a.instance or "this")
    if a.out:
        written = write_files(files, a.out)
        emit(
            f"Wrote {len(written)} files to {a.out}:\n"
            + "\n".join(f"  - {f}" for f in written)
        )
    else:
        emit(format_scaffold_files(files))


def cmd_scan(a):
    if a.stdin:
        hcl = sys.stdin.read()
    elif a.file:
        with open(a.file) as f:
            hcl = f.read()
    else:
        print("error: provide --file PATH or --stdin", file=sys.stderr)
        sys.exit(2)
    emit(format_scan_result(scan_hcl(hcl), a.label or "provided HCL"))


def cmd_validate(a):
    mod = get_module(normalize_name(a.name))
    files = generate_scaffold(mod, a.instance or "this")
    report = format_scan_result(
        scan_hcl(files["main.tf"]), f"{normalize_name(a.name)} scaffold"
    )
    if a.out:
        write_files(files, a.out)
    emit(f"{format_scaffold_files(files)}\n\n---\n\n{report}")


def main():
    p = argparse.ArgumentParser(description="Self-contained ARC IaC toolkit")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("list")
    s.add_argument("--sort", choices=["downloads", "name"])
    s.set_defaults(fn=cmd_list)

    s = sub.add_parser("search")
    s.add_argument("query")
    s.set_defaults(fn=cmd_search)

    s = sub.add_parser("get")
    s.add_argument("name")
    s.add_argument("--readme", action="store_true")
    s.set_defaults(fn=cmd_get)

    s = sub.add_parser("inputs")
    s.add_argument("name")
    s.set_defaults(fn=cmd_inputs)

    s = sub.add_parser("outputs")
    s.add_argument("name")
    s.set_defaults(fn=cmd_outputs)

    s = sub.add_parser("resources")
    s.add_argument("name")
    s.set_defaults(fn=cmd_resources)

    s = sub.add_parser("versions")
    s.add_argument("name")
    s.set_defaults(fn=cmd_versions)

    s = sub.add_parser("find-by-resource")
    s.add_argument("resource")
    s.set_defaults(fn=cmd_find_by_resource)

    s = sub.add_parser("compare")
    s.add_argument("module_a")
    s.add_argument("module_b")
    s.set_defaults(fn=cmd_compare)

    s = sub.add_parser("scaffold")
    s.add_argument("name")
    s.add_argument("--instance")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_scaffold)

    s = sub.add_parser("scan")
    s.add_argument("--file")
    s.add_argument("--stdin", action="store_true")
    s.add_argument("--label")
    s.set_defaults(fn=cmd_scan)

    s = sub.add_parser("validate")
    s.add_argument("name")
    s.add_argument("--instance")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_validate)

    args = p.parse_args()
    try:
        args.fn(args)
    except urllib.error.HTTPError as e:
        print(f"Error: Registry/scan HTTP {e.code} — {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Error: network — {e.reason}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()