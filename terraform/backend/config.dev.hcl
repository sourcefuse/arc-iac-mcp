bucket         = "REPLACE_WITH_YOUR_STATE_BUCKET"
key            = "arc-iac-mcp/dev/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "REPLACE_WITH_YOUR_LOCK_TABLE"
