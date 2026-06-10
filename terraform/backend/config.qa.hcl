bucket         = "REPLACE_WITH_YOUR_STATE_BUCKET"
key            = "arc-iac-mcp/qa/terraform.tfstate"
region         = "us-east-1"
encrypt        = true
dynamodb_table = "REPLACE_WITH_YOUR_LOCK_TABLE"
