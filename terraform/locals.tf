locals {
  env_config = {
    dev = {
      custom_domain_name = "arc-iac-mcp-dev.sourcefuse.com"
      cors_allow_origins = ["https://arc-iac-mcp-dev.sourcefuse.com"]
      log_retention_days = 7
      lambda_memory_size = 512
      enable_xray        = true
      enable_keep_warm   = false
      environment_tag    = "development"
      additional_tags    = {}
    }
    qa = {
      custom_domain_name = "arc-iac-mcp-qa.sourcefuse.com"
      cors_allow_origins = ["https://arc-iac-mcp-qa.sourcefuse.com"]
      log_retention_days = 14
      lambda_memory_size = 512
      enable_xray        = true
      enable_keep_warm   = false
      environment_tag    = "qa"
      additional_tags    = {}
    }
    stg = {
      custom_domain_name = "arc-iac-mcp-stg.sourcefuse.com"
      cors_allow_origins = ["https://arc-iac-mcp-stg.sourcefuse.com"]
      log_retention_days = 30
      lambda_memory_size = 512
      enable_xray        = true
      enable_keep_warm   = true
      environment_tag    = "staging"
      additional_tags    = {}
    }
    prod = {
      custom_domain_name = "arc-iac-mcp.sourcefuse.com"
      cors_allow_origins = ["https://arc-iac-mcp.sourcefuse.com"]
      log_retention_days = 90
      lambda_memory_size = 1024
      enable_xray        = true
      enable_keep_warm   = true
      environment_tag    = "production"
      additional_tags = {
        Compliance = "required"
      }
    }
  }

  config = local.env_config[var.environment]

  hosted_zone_name = "sourcefuse.com"
  tags = merge(
    {
      Project     = "arc-iac-mcp"
      ManagedBy   = "terraform"
      Environment = local.config.environment_tag
      Owner       = "sourcefuse"
      CostCenter  = "engineering"
    },
    local.config.additional_tags
  )
}
