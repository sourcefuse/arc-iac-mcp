################################################################################
# Required Variables
################################################################################

variable "namespace" {
  description = "Namespace for the resources (e.g., 'sourcefuse' or your org name)"
  type        = string
  default     = "arc"
}

variable "environment" {
  description = "Environment name"
  type        = string

  validation {
    condition     = contains(["prod"], var.environment)
    error_message = "Environment must be 'prod'."
  }
}

variable "name" {
  description = "Name of the application/service"
  type        = string
  default     = "iac-mcp"
}

variable "region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

################################################################################
# Lambda Configuration
################################################################################

variable "lambda_runtime" {
  description = "Lambda runtime version"
  type        = string
  default     = "nodejs18.x"

  validation {
    condition     = contains(["nodejs18.x", "nodejs20.x"], var.lambda_runtime)
    error_message = "Lambda runtime must be nodejs18.x or nodejs20.x."
  }
}

variable "lambda_timeout" {
  description = "Amount of time your Lambda Function has to run in seconds"
  type        = number
  default     = 30

  validation {
    condition     = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "Lambda timeout must be between 1 and 900 seconds."
  }
}

variable "lambda_package_path" {
  description = "Path to the pre-built Lambda deployment zip, relative to the terraform directory"
  type        = string
  default     = "lambda-deployment.zip"
}

variable "environment_variables" {
  description = "Environment variables for Lambda function"
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "keep_warm_interval_minutes" {
  description = "Interval in minutes to invoke Lambda for keep-warm (if enabled)"
  type        = number
  default     = 5

  validation {
    condition     = var.keep_warm_interval_minutes >= 1 && var.keep_warm_interval_minutes <= 60
    error_message = "Keep warm interval must be between 1 and 60 minutes."
  }
}

################################################################################
# WAF Configuration
################################################################################

variable "waf_default_action" {
  description = "Default action for WAF Web ACL when no rules match. Options: 'allow' or 'block'"
  type        = string
  default     = "allow"

  validation {
    condition     = contains(["allow", "block"], var.waf_default_action)
    error_message = "WAF default action must be 'allow' or 'block'."
  }
}

variable "waf_rate_limit" {
  description = "Maximum number of requests per 5 minutes per IP before WAF blocks them"
  type        = number
  default     = 1000

  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "WAF rate limit must be at least 100 requests."
  }
}