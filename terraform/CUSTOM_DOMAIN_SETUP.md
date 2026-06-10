# Custom Domain Setup

This deployment uses the SourceFuse ARC API Gateway module for API Gateway, custom domain mapping, and Route53 alias records.

## Custom Domain

This project is configured for the `sourcefuse.com` hosted zone:

```hcl
custom_domain_name = "arc-iac-mcp.sourcefuse.com"
hosted_zone_name   = "sourcefuse.com"
certificate_arn    = "arn:aws:acm:us-east-1:123456789012:certificate/abc123"
```

Environment hostnames:

| Environment | Hostname |
|-------------|----------|
| dev | `arc-iac-mcp-dev.sourcefuse.com` |
| qa | `arc-iac-mcp-qa.sourcefuse.com` |
| stg | `arc-iac-mcp-stg.sourcefuse.com` |
| prod | `arc-iac-mcp.sourcefuse.com` |

In GitHub Actions, set one shared wildcard certificate variable if your ACM certificate covers `*.sourcefuse.com`:

```text
ACM_CERTIFICATE_ARN_SOURCEFUSE
```

Optional per-environment overrides are also supported:

| Environment | GitHub variable |
|-------------|-----------------|
| dev | `ACM_CERTIFICATE_ARN_DEV` |
| qa | `ACM_CERTIFICATE_ARN_QA` |
| stg | `ACM_CERTIFICATE_ARN_STG` |
| prod | `ACM_CERTIFICATE_ARN_PROD` |

The ARC API Gateway module creates:

- API Gateway custom domain
- API Gateway base path mapping
- Route53 alias record

It does not create the ACM certificate. Create or import the certificate separately, then add the wildcard ARN to `ACM_CERTIFICATE_ARN_SOURCEFUSE` or pass `-var="certificate_arn=..."` for local Terraform runs.

## Verify

After apply:

```bash
terraform output mcp_endpoint
terraform output -raw curl_test_command | bash
```

DNS can take a few minutes to propagate after the Route53 alias is created.
