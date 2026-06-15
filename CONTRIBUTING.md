# Contributing to ARC IaC Agent Skills

Thank you for your interest in contributing! This project welcomes improvements from the community.

## How to Contribute

### Reporting Issues

- Report issues through GitHub Issues.
- When reporting a bug, include steps to reproduce it, expected behavior, and any relevant logs or screenshots.


### Pull Requests

1. **Fork** the repository
2. **Create a feature branch**: `git checkout -b feature/my-improvement`
3. **Make your changes**
4. **Test `scripts/arc.py` parses**:
   ```bash
   python3 -c "import ast, sys; ast.parse(open('scripts/arc.py').read())"
   ```
5. **Commit** with a clear message
6. **Open a PR** against the main branch
