#!/bin/bash

# Test script for MCP server endpoints
MCP_URL="https://arc-iac-mcp.sourcef.us/mcp"

echo "======================================"
echo "Testing MCP Server: $MCP_URL"
echo "======================================"
echo ""

# Test 1: Health check
echo "1. Health Check (GET /)"
curl -s https://arc-iac-mcp.sourcef.us/ | python3 -m json.tool
echo ""
echo ""

# Test 2: Initialize
echo "2. MCP Initialize"
INIT_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    }
  }')

echo "$INIT_RESPONSE" | python3 -m json.tool
echo ""

# Check for error
if echo "$INIT_RESPONSE" | grep -q '"error"'; then
  echo "❌ Initialize FAILED"
  exit 1
else
  echo "✅ Initialize SUCCESS"
fi
echo ""

# Test 3: Tools List
echo "3. MCP Tools List"
TOOLS_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }')

TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('result', {}).get('tools', [])))" 2>/dev/null || echo "0")
echo "Found $TOOL_COUNT tools"

if [ "$TOOL_COUNT" -gt 0 ]; then
  echo "✅ Tools List SUCCESS"
else
  echo "❌ Tools List FAILED"
  echo "$TOOLS_RESPONSE" | python3 -m json.tool
  exit 1
fi
echo ""

# Test 4: Call a tool
echo "4. MCP Tool Call (arc_list_modules)"
CALL_RESPONSE=$(curl -s -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "arc_list_modules",
      "arguments": {}
    }
  }')

# Check if we got modules back
MODULE_COUNT=$(echo "$CALL_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); content=data.get('result', {}).get('content', []); print(len(json.loads(content[0]['text'])) if content else 0)" 2>/dev/null || echo "0")

if [ "$MODULE_COUNT" -gt 0 ]; then
  echo "✅ Tool Call SUCCESS - Retrieved $MODULE_COUNT modules"
else
  echo "❌ Tool Call FAILED"
  echo "$CALL_RESPONSE" | python3 -m json.tool | head -30
  exit 1
fi

echo ""
echo "======================================"
echo "✅ ALL TESTS PASSED"
echo "======================================"
