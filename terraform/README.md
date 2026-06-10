# ARC IaC MCP - Terraform Module

Terraform configuration for deploying the ARC IaC MCP server to AWS Lambda and API Gateway using SourceFuse ARC module patterns.

## 📁 Directory Structure

```
terraform/
├── main.tf                    # Main infrastructure using ARC Lambda and API Gateway modules
├── locals.tf                  # Environment-specific defaults and domain settings
├── variables.tf               # Variable definitions
├── outputs.tf                 # Output definitions
├── versions.tf                # Provider requirements
├── backend/                   # Backend configurations per environment
│   ├── config.dev.hcl
│   ├── config.qa.hcl
│   ├── config.stg.hcl
│   └── config.prod.hcl
├── tfvars/                    # Environment-specific configurations
│   ├── dev.tfvars
│   ├── qa.tfvars
│   ├── stg.tfvars
│   └── prod.tfvars
└── README.md                  # This file
```

## 🚀 Quick Start

### Deploy to Development

```bash
# Navigate to terraform directory
cd terraform/

# Initialize with dev backend
terraform init -backend-config=backend/config.dev.hcl

# Plan with dev variables
terraform plan -var-file=tfvars/dev.tfvars -var="certificate_arn=<acm-certificate-arn>"

# Apply
terraform apply -var-file=tfvars/dev.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

### Deploy to Production

```bash
# Initialize with prod backend
terraform init -backend-config=backend/config.prod.hcl

# Plan with prod variables
terraform plan -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"

# Apply
terraform apply -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

## 🏗️ Architecture

Uses SourceFuse ARC modules:

- **ARC Lambda Function** (`sourcefuse/arc-lambda-function/aws` v0.0.3)
- **ARC API Gateway** (`sourcefuse/arc-api-gateway/aws` v0.0.2)

```hcl
module "lambda" {
  source  = "sourcefuse/arc-lambda-function/aws"
  version = "0.0.3"

  # Lambda configuration
  function_name = "${var.namespace}-${var.environment}-${var.name}"
  runtime       = var.lambda_runtime
  handler       = "dist/index.handler"
  # ... more configuration
}

module "api_gateway" {
  source  = "sourcefuse/arc-api-gateway/aws"
  version = "0.0.2"

  name          = "${var.namespace}-${var.environment}-${var.name}-api"
  stage_name    = var.environment
  open_api_json = local.api_openapi_json
}
```

### Resources Created

**By ARC Lambda Module:**
- AWS Lambda Function
- IAM Role with proper permissions
- CloudWatch Log Group

**By ARC API Gateway Module:**
- API Gateway REST API
- API Gateway stage and deployment
- Lambda invoke permission for API Gateway
- CloudWatch logging role
- Custom domain and Route53 alias if configured

**Additional Resources:**
- EventBridge Keep-Warm Rule (if enabled)

### Lambda Package

Terraform expects a pre-built Lambda package at:

```text
terraform/lambda-deployment.zip
```

The GitHub Actions workflow creates this artifact after `npm run build`. Terraform intentionally does not run `npm` or package application code.

## 🎯 Endpoint Format

After deployment, you'll get:

```
dev:   https://arc-iac-mcp-dev.sourcefuse.com/mcp
qa:    https://arc-iac-mcp-qa.sourcefuse.com/mcp
stg:   https://arc-iac-mcp-stg.sourcefuse.com/mcp
prod:  https://arc-iac-mcp.sourcefuse.com/mcp
```

Get your endpoint:
```bash
terraform output mcp_endpoint
```

## 📝 Configuration

### Backend Configuration

Edit `backend/config.<env>.hcl` files with your S3 bucket and DynamoDB table:

```hcl
bucket         = "your-terraform-state-bucket"
key            = "arc-iac-mcp/<env>/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "terraform-state-lock"
```

### Environment Configuration

The `tfvars/<env>.tfvars` files only select the environment:

```hcl
environment = "dev"
```

Environment-specific defaults live in `locals.tf`, including custom domains, CORS origins, memory size, log retention, X-Ray, keep-warm, and tags.

### Custom Domains

Custom domains are handled by the ARC API Gateway module and use the `sourcefuse.com` hosted zone:

```hcl
custom_domain_name = "arc-iac-mcp.sourcefuse.com"
hosted_zone_name   = "sourcefuse.com"
certificate_arn    = "arn:aws:acm:us-east-1:123456789012:certificate/abc123"
```

Configured hostnames:

| Environment | Hostname |
|-------------|----------|
| dev | `arc-iac-mcp-dev.sourcefuse.com` |
| qa | `arc-iac-mcp-qa.sourcefuse.com` |
| stg | `arc-iac-mcp-stg.sourcefuse.com` |
| prod | `arc-iac-mcp.sourcefuse.com` |

For GitHub Actions, set `ACM_CERTIFICATE_ARN_SOURCEFUSE` to the wildcard ACM certificate ARN that covers `*.sourcefuse.com`. Per-environment overrides are still supported with `ACM_CERTIFICATE_ARN_DEV`, `ACM_CERTIFICATE_ARN_QA`, `ACM_CERTIFICATE_ARN_STG`, or `ACM_CERTIFICATE_ARN_PROD`.

## 🔧 Common Commands

### Initialize for Environment

```bash
# Development
terraform init -backend-config=backend/config.dev.hcl

# Production
terraform init -backend-config=backend/config.prod.hcl
```

### Plan Changes

```bash
terraform plan -var-file=tfvars/dev.tfvars -var="certificate_arn=<acm-certificate-arn>"
terraform plan -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

### Apply Changes

```bash
terraform apply -var-file=tfvars/dev.tfvars -var="certificate_arn=<acm-certificate-arn>"
terraform apply -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

### View Outputs

```bash
terraform output
terraform output mcp_endpoint
terraform output claude_desktop_config
terraform output kiro_config
```

### Switch Environments

```bash
# Reinitialize with different backend
terraform init -reconfigure -backend-config=backend/config.prod.hcl

# Apply with different tfvars
terraform apply -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

## 📊 Outputs

| Output | Description |
|--------|-------------|
| `function_name` | Lambda function name |
| `function_arn` | Lambda function ARN |
| `api_gateway_endpoint` | Base API Gateway endpoint |
| `mcp_endpoint` | Full MCP endpoint URL |
| `iam_role_arn` | IAM execution role ARN |
| `cloudwatch_log_group` | CloudWatch log group name |
| `claude_desktop_config` | Claude Desktop config snippet |
| `kiro_config` | Kiro config snippet |
| `curl_test_command` | Command to test endpoint |
| `logs_command` | Command to view logs |

## 🧪 Testing

### Health Check

```bash
curl $(terraform output -raw function_url)
```

### Test MCP Endpoint

```bash
terraform output -raw curl_test_command | bash
```

### View Logs

```bash
terraform output -raw logs_command | bash
```

## 🔐 Backend Setup

### 1. Create S3 Bucket

```bash
export STATE_BUCKET="your-terraform-state-bucket"
export AWS_REGION="us-east-1"

aws s3 mb s3://${STATE_BUCKET} --region ${AWS_REGION}

aws s3api put-bucket-versioning \
  --bucket ${STATE_BUCKET} \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket ${STATE_BUCKET} \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      }
    }]
  }'
```

### 2. Create DynamoDB Table

```bash
export DYNAMODB_TABLE="terraform-state-lock"

aws dynamodb create-table \
  --table-name ${DYNAMODB_TABLE} \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ${AWS_REGION}
```

### 3. Update Backend Configs

Edit all `backend/config.*.hcl` files with your bucket and table names.

## 💰 Cost Estimate

| Environment | Monthly Cost |
|-------------|--------------|
| **Development** | $0.50-1 |
| **QA** | $1-2 |
| **Staging** | $2-3 |
| **Production** | $2-4 |

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v2
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Build application
        run: |
          npm ci --ignore-scripts
          npm run build
          rm -rf terraform/lambda-deploy terraform/lambda-deployment.zip
          mkdir -p terraform/lambda-deploy
          cp package.json package-lock.json terraform/lambda-deploy/
          cp -R dist terraform/lambda-deploy/
          npm ci --ignore-scripts --omit=dev --prefix terraform/lambda-deploy
          cd terraform/lambda-deploy
          zip -qr ../lambda-deployment.zip .
      
      - name: Terraform Init
        working-directory: terraform
        run: terraform init -backend-config=backend/config.prod.hcl
      
      - name: Terraform Apply
        working-directory: terraform
        run: terraform apply -var-file=tfvars/prod.tfvars -var="certificate_arn=${{ vars.ACM_CERTIFICATE_ARN_SOURCEFUSE }}" -auto-approve
```

## 📚 Module Documentation

- **ARC Lambda Function Module**: https://registry.terraform.io/modules/sourcefuse/arc-lambda-function/aws
- **ARC API Gateway Module**: https://registry.terraform.io/modules/sourcefuse/arc-api-gateway/aws

## 🆘 Troubleshooting

### "Backend initialization required"

```bash
terraform init -backend-config=backend/config.dev.hcl
```

### "No such file: terraform/lambda-deployment.zip"

Build and package the application first:
```bash
cd ..
npm ci --ignore-scripts
npm run build
rm -rf terraform/lambda-deploy terraform/lambda-deployment.zip
mkdir -p terraform/lambda-deploy
cp package.json package-lock.json terraform/lambda-deploy/
cp -R dist terraform/lambda-deploy/
npm ci --ignore-scripts --omit=dev --prefix terraform/lambda-deploy
cd terraform/lambda-deploy && zip -qr ../lambda-deployment.zip .
cd ..
```

### Switch Between Environments

```bash
# Reinitialize with new backend
terraform init -reconfigure -backend-config=backend/config.prod.hcl

# Apply with new tfvars
terraform apply -var-file=tfvars/prod.tfvars -var="certificate_arn=<acm-certificate-arn>"
```

## ✅ Deployment Checklist

- [ ] S3 bucket created for state
- [ ] DynamoDB table created for locking
- [ ] Backend config files updated
- [ ] Environment tfvars reviewed
- [ ] Application built (`npm run build`)
- [ ] Terraform initialized with correct backend
- [ ] Plan reviewed
- [ ] Applied to environment
- [ ] Endpoint tested
- [ ] MCP clients configured

## 📖 Additional Resources

- [Terraform Backend Configuration](https://www.terraform.io/docs/language/settings/backends/s3.html)
- [SourceFuse ARC Modules](https://registry.terraform.io/namespaces/sourcefuse)
- [API Gateway Custom Domain Names](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-custom-domains.html)

---

**Following SourceFuse ARC Infrastructure Patterns**
