# Agents Tools Directory

This directory contains utility modules and tools used by Mission Control agents.

## nim_reranker.py

### Purpose
Provides a reranking function that uses the NVIDIA NIM API to score and rank passages by relevance to a query. This enhances Cortana's retrieval layer by providing cleaner, higher-signal context to downstream agents.

### Interface
```python
from nim_reranker import rerank

results = rerank(
    query="What is the current status of the BTC treasury project?",
    passages=["passage 1...", "passage 2...", "passage 3..."],
    top_n=3
)
# Returns: [{"passage": "...", "score": 0.94}, ...]
```

### Parameters
- `query` (str): The query string to rank passages against
- `passages` (List[str]): List of passage strings to be ranked
- `top_n` (Optional[int]): Limit on number of passages to return (default: None, returns all)
- `api_url` (str): NVIDIA NIM reranker API endpoint (default: "https://integrate.api.nvidia.com/v1/rerank")

### Returns
List of dictionaries with keys:
- `passage` (str): The original passage text
- `score` (float): Relevance score from the NIM reranker (higher is more relevant)

### Dependencies
- Python 3.9+
- Standard library modules: json, urllib.request, urllib.error, datetime, os, typing
- NVIDIA API key set in environment variable `NVIDIA_API_KEY`

### Environment Variables
- `NVIDIA_API_KEY`: Your NVIDIA NGC API key for accessing the NIM reranker

### Error Handling
- Raises `ValueError` if API key is missing
- Raises `ConnectionError` if API request fails
- Raises `RuntimeError` if API returns unexpected response format

### Logging
The module logs reranking operations to stdout in JSON format prefixed with `[RERANKER_LOG]` for easy capture.

## Adding Additional NIM Tools

To add additional NVIDIA NIM tools to this directory:

1. Follow the same pattern as `nim_reranker.py`
2. Use environment variables for API keys (never hardcode)
3. Implement proper error handling and logging
4. Document the interface in this README
5. Add any necessary dependencies to the documentation

### Example Structure
```python
#!/usr/bin/env python3
"""
Description of the NIM tool
"""

import json
import urllib.request
import os
from typing import List, Dict, Union

def _get_api_key():
    """Get API key from environment."""
    api_key = os.environ.get('NIM_TOOL_API_KEY')
    if not api_key:
        raise ValueError("API key not found")
    return api_key

def your_function(params):
    # Implementation using NVIDIA NIM API
    pass
```