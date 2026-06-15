terraform {
  required_version = ">= 1.3.0"

  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

# Module versions pinned in module blocks:
#   sourcefuse/arc-lambda-function/aws  0.0.3
#   sourcefuse/arc-api-gateway/aws      0.0.2
#   sourcefuse/arc-waf/aws              1.0.7
#
# Run `terraform init` after adding arc-waf to update .terraform.lock.hcl
