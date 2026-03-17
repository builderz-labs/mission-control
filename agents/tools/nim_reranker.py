#!/usr/bin/env python3
"""
NVIDIA NIM Reranker for Mission Control

This module provides a reranking function that uses the NVIDIA NIM API
to score and rank passages by relevance to a query.
"""

import json
import urllib.request
import urllib.error
from datetime import datetime
from typing import List, Dict, Union, Optional
import os


def _get_nvidia_api_key() -> str:
    """Get NVIDIA API key from environment."""
    api_key = os.environ.get('NVIDIA_API_KEY')
    if not api_key:
        # Try to read from the env file we created
        env_file = os.path.expanduser('~/nvidia_api_key.env')
        if os.path.exists(env_file):
            with open(env_file, 'r') as f:
                for line in f:
                    if line.startswith('export NVIDIA_API_KEY='):
                        api_key = line.split('=', 1)[1].strip().strip('"')
                        break
    
    if not api_key:
        raise ValueError(
            "NVIDIA API key not found. Set NVIDIA_API_KEY environment variable "
            "or ensure it's available in ~/nvidia_api_key.env"
        )
    return api_key


def rerank(
    query: str,
    passages: List[str],
    top_n: Optional[int] = None,
    api_url: str = "https://integrate.api.nvidia.com/v1/rerank"
) -> List[Dict[str, Union[str, float]]]:
    """
    Rerank passages by relevance to query using NVIDIA NIM reranker.
    
    Args:
        query: The query string to rank passages against
        passages: List of passage strings to be ranked
        top_n: Optional limit on number of passages to return (default: all)
        api_url: NVIDIA NIM reranker API endpoint
        
    Returns:
        List of dictionaries with keys 'passage' and 'score', sorted by score descending
        
    Raises:
        ValueError: If API key is missing or invalid
        ConnectionError: If API request fails
        RuntimeError: If API returns an error
    """
    if not passages:
        return []
    
    # Get API key
    api_key = _get_nvidia_api_key()
    
    # Prepare request data
    data = {
        "model": "nvidia/nv-rerankqa-mistral-4b-v3",
        "query": query,
        "passages": passages,
        "truncate": "END"
    }
    
    # Convert to JSON
    json_data = json.dumps(data).encode('utf-8')
    
    # Prepare request
    req = urllib.request.Request(
        api_url,
        data=json_data,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        },
        method='POST'
    )
    
    try:
        # Make request
        with urllib.request.urlopen(req) as response:
            response_data = json.loads(response.read().decode('utf-8'))
        
        # Extract results
        if 'results' not in response_data:
            raise RuntimeError(f"Unexpected API response format: {response_data}")
        
        # Format results
        results = []
        for result in response_data['results']:
            results.append({
                'passage': passages[result['index']],
                'score': result['relevance_score']
            })
        
        # Sort by score descending
        results.sort(key=lambda x: x['score'], reverse=True)
        
        # Apply top_n limit if specified
        if top_n is not None:
            results = results[:top_n]
            
        # Log the operation
        _log_rerank_operation(query, passages, results)
        
        return results
        
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.read() else "No response body"
        raise ConnectionError(
            f"HTTP error {e.code} calling NVIDIA NIM API: {e.reason}\n"
            f"Response: {error_body}"
        )
    except urllib.error.URLError as e:
        raise ConnectionError(f"Failed to connect to NVIDIA NIM API: {e.reason}")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse API response: {e}")


def _log_rerank_operation(query: str, passages: List[str], results: List[Dict]) -> None:
    """Log the reranking operation."""
    timestamp = datetime.now().isoformat()
    log_entry = {
        "timestamp": timestamp,
        "query": query,
        "num_passages": len(passages),
        "num_returned": len(results),
        "scores": [r['score'] for r in results] if results else []
    }
    
    # In a real implementation, this would go to a proper log file
    # For now, we'll just print to stdout in a format that could be captured
    print(f"[RERANKER_LOG] {json.dumps(log_entry)}")


# Example usage and simple test
if __name__ == "__main__":
    # This allows the module to be run directly for testing
    test_query = "What is the capital of France?"
    test_passages = [
        "Paris is the capital of France.",
        "The Eiffel Tower is in Paris.",
        "France is a country in Europe.",
        "London is the capital of the UK.",
        "Berlin is the capital of Germany."
    ]
    
    try:
        results = rerank(test_query, test_passages, top_n=3)
        print("Test successful!")
        for i, result in enumerate(results):
            print(f"{i+1}. Score: {result['score']:.4f} - {result['passage'][:50]}...")
    except Exception as e:
        print(f"Test failed: {e}")