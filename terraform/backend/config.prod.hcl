bucket         = "REPLACE_WITH_YOUR_STATE_BUCKET"
key            = "arc-iac-mcp/prod/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "REPLACE_WITH_YOUR_LOCK_TABLE"
