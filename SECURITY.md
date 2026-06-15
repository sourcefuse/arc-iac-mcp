# Security Policy


## Reporting a Vulnerability

If you discover a security issue in this project, please **do not open a public issue**.

Instead, report it privately by emailing the maintainers with:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)


## Security Notes

- `scripts/arc.py` fetches data from the **public Terraform Registry API** over HTTPS. No API keys are required.
- Security scanning requires either a local `tfsec` binary or the hosted scan service. Set `SCAN_SERVICE_URL` to use your own endpoint.
- Set `ARC_INSECURE=1` **only** as a last resort for broken corporate TLS proxies.
- Never commit AWS credentials, `.tfstate` files, or private keys to this repository.