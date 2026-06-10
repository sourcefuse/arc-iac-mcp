################################################################################
# Lambda Function Outputs
################################################################################

output "function_name" {
  description = "Name of the Lambda function"
  value       = module.lambda.name
}

output "function_arn" {
  description = "ARN of the Lambda function"
  value       = module.lambda.arn
}

output "function_invoke_arn" {
  description = "Invoke ARN of the Lambda function"
  value       = module.lambda.invoke_arn
}

output "function_version" {
  description = "Latest published version of the Lambda function"
  value       = module.lambda.version
}

################################################################################
# Function URL Outputs
################################################################################

output "function_url" {
  description = "URL of the Lambda function (base endpoint)"
  value       = module.lambda.url
}

output "api_gateway_endpoint" {
  description = "Base API Gateway endpoint"
  value       = module.api_gateway.invoke_url
}

output "mcp_endpoint" {
  description = "MCP endpoint URL (use this in your MCP client configs)"
  value       = local.mcp_endpoint
}

output "custom_domain_endpoint" {
  description = "Custom domain MCP endpoint, if configured"
  value       = local.mcp_endpoint
}

################################################################################
# IAM Outputs
################################################################################

output "iam_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = module.lambda.role_arn
}

output "iam_role_name" {
  description = "Name of the Lambda execution role"
  value       = null
}

################################################################################
# CloudWatch Outputs
################################################################################

output "cloudwatch_log_group" {
  description = "CloudWatch Log Group name"
  value       = module.lambda.cloudwatch_log_group_name
}

output "cloudwatch_log_group_arn" {
  description = "CloudWatch Log Group ARN"
  value       = module.lambda.cloudwatch_log_group_arn
}

################################################################################
# Deployment Info
################################################################################

output "deployment_package_size" {
  description = "Lambda deployment package path"
  value       = var.lambda_package_path
}

output "runtime" {
  description = "Lambda runtime version"
  value       = var.lambda_runtime
}

output "memory_size" {
  description = "Lambda memory size in MB"
  value       = local.config.lambda_memory_size
}

output "timeout" {
  description = "Lambda timeout in seconds"
  value       = var.lambda_timeout
}

output "region" {
  description = "AWS region where resources are deployed"
  value       = var.region
}

################################################################################
# MCP Client Configuration Snippets
################################################################################

output "claude_desktop_config" {
  description = "Configuration snippet for Claude Desktop"
  value = jsonencode({
    mcpServers = {
      "arc-iac" = {
        url = local.mcp_endpoint
      }
    }
  })
}

output "kiro_config" {
  description = "Configuration snippet for Kiro"
  value = jsonencode({
    mcpServers = {
      "arc-iac" = {
        url         = local.mcp_endpoint
        autoApprove = ["*"]
        disabled    = false
      }
    }
  })
}

################################################################################
# Utility Commands
################################################################################

output "curl_test_command" {
  description = "Curl command to test the MCP endpoint"
  value       = "curl -X POST ${local.mcp_endpoint} -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'"
}

output "logs_command" {
  description = "AWS CLI command to view logs"
  value       = "aws logs tail ${module.lambda.cloudwatch_log_group_name} --follow --region ${var.region}"
}
