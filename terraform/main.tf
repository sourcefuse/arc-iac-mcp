################################################################################
# ARC IaC MCP Server - Lambda Deployment
# Using SourceFuse ARC Modules
################################################################################

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}

################################################################################
# Locals
################################################################################

locals {
  function_name       = "${var.namespace}-${var.environment}-${var.name}"
  lambda_package_path = "${path.module}/${var.lambda_package_path}"
  api_name            = "${local.function_name}-api"
  mcp_endpoint        = "https://${local.config.custom_domain_name}/mcp"
  api_gateway_domain = {
    create              = true
    domain              = local.config.custom_domain_name
    route53_root_domain = local.hosted_zone_name
    certificate_arn     = data.aws_acm_certificate.issued.arn
  }

  environment_variables = merge(
    {
      NODE_ENV = "production"
    },
    var.environment_variables
  )

  api_openapi_json = jsonencode({
    openapi = "3.0.1"
    info = {
      title   = "ARC IaC MCP Server"
      version = "1.0.0"
    }
    paths = {
      "/" = {
        get = {
          security = []
          responses = {
            "200" = {
              description = "Health response"
            }
          }
          "x-amazon-apigateway-integration" = {
            type       = "aws_proxy"
            httpMethod = "POST"
            uri        = module.lambda.invoke_arn
          }
        }
      }
      "/mcp" = {
        post = {
          security = []
          responses = {
            "200" = {
              description = "MCP response"
            }
          }
          "x-amazon-apigateway-integration" = {
            type       = "aws_proxy"
            httpMethod = "POST"
            uri        = module.lambda.invoke_arn
          }
        }
        delete = {
          security = []
          responses = {
            "200" = {
              description = "MCP session delete response"
            }
          }
          "x-amazon-apigateway-integration" = {
            type       = "aws_proxy"
            httpMethod = "POST"
            uri        = module.lambda.invoke_arn
          }
        }
        options = {
          security = []
          responses = {
            "204" = {
              description = "CORS preflight response"
              headers = {
                "Access-Control-Allow-Headers" = { type = "string" }
                "Access-Control-Allow-Methods" = { type = "string" }
                "Access-Control-Allow-Origin"  = { type = "string" }
              }
            }
          }
          "x-amazon-apigateway-integration" = {
            type = "mock"
            requestTemplates = {
              "application/json" = "{\"statusCode\": 204}"
            }
            responses = {
              default = {
                statusCode = "204"
                responseParameters = {
                  "method.response.header.Access-Control-Allow-Headers" = "'*'"
                  "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
                  "method.response.header.Access-Control-Allow-Origin"  = "'${join(",", local.config.cors_allow_origins)}'"
                }
              }
            }
          }
        }
      }
    }
  })
}

################################################################################
# ARC Lambda Function Module
################################################################################

module "lambda" {
  source  = "sourcefuse/arc-lambda-function/aws"
  version = "0.0.3"

  # Lambda Configuration
  function_name = local.function_name
  description   = "ARC IaC MCP Server - SourceFuse Terraform modules via Model Context Protocol"
  runtime       = var.lambda_runtime
  handler       = "dist/index.handler"
  filename      = local.lambda_package_path
  timeout       = var.lambda_timeout
  memory_size   = local.config.lambda_memory_size

  # Deployment Package
  source_code_hash = filebase64sha256(local.lambda_package_path)

  # Environment Variables
  environment_variables = local.environment_variables

  # Logging
  create_log_group      = true
  log_retention_in_days = local.config.log_retention_days

  # Tracing
  tracing_config = local.config.enable_xray ? {
    mode = "Active"
  } : null

  # Tags
  tags = local.tags
}

################################################################################
# EventBridge Keep-Warm (Optional)
################################################################################

resource "aws_cloudwatch_event_rule" "keep_warm" {
  count               = local.config.enable_keep_warm ? 1 : 0
  name                = "${local.function_name}-keep-warm"
  description         = "Keep Lambda function warm to reduce cold starts"
  schedule_expression = "rate(${var.keep_warm_interval_minutes} minutes)"

  tags = local.tags
}

resource "aws_cloudwatch_event_target" "keep_warm" {
  count     = local.config.enable_keep_warm ? 1 : 0
  rule      = aws_cloudwatch_event_rule.keep_warm[0].name
  target_id = "KeepWarmTarget"
  arn       = module.lambda.arn

  input = jsonencode({
    keepWarm = true
  })
}

resource "aws_lambda_permission" "eventbridge" {
  count         = local.config.enable_keep_warm ? 1 : 0
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.keep_warm[0].arn
}

################################################################################
# ARC API Gateway Module
################################################################################

module "api_gateway" {
  source  = "sourcefuse/arc-api-gateway/aws"
  version = "0.0.2"

  name                   = local.api_name
  stage_name             = var.environment
  endpoint_type          = "REGIONAL"
  open_api_json          = local.api_openapi_json
  enable_cloudwatch_logs = true
  xray_tracing_enabled   = local.config.enable_xray
  api_gateway_domain     = local.api_gateway_domain

  lambda_permissions = {
    mcp = {
      statement_id  = "AllowAPIGatewayInvoke"
      action        = "lambda:InvokeFunction"
      function_name = module.lambda.name
      principal     = "apigateway.amazonaws.com"
    }
  }

  tags = local.tags
}

################################################################################
# ACM Certificate (Use Existing)
################################################################################

data "aws_acm_certificate" "issued" {
  domain   = "*.${local.hosted_zone_name}"
  statuses = ["ISSUED"]
  key_types = ["RSA_2048"]
}
