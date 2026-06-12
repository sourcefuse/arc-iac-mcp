locals {
  env_config = {
    prod = {
      custom_domain_name = "arc-iac-mcp.sourcef.us"
      cors_allow_origins = ["https://arc-iac-mcp.sourcef.us"]
      log_retention_days = 7
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

  hosted_zone_name = "arc-iac-mcp.sourcef.us"
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
