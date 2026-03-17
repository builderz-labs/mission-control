#!/usr/bin/env python3
"""
Test script for NVIDIA NIM Reranker
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nim_reranker import rerank


def test_reranker():
    """Test the reranker with sample data."""
    print("Testing NVIDIA NIM Reranker...")
    
    # Test query related to Mission Control
    query = "What tasks did Sagan complete recently?"
    
    # Mock passages with varying relevance
    passages = [
        "Sagan completed the deep research project on quantum computing applications in finance last week.",
        "The weather today is sunny with a high of 75 degrees Fahrenheit.",
        "Sagan published a report on market trends analysis for Q2 2026.",
        "Elon coordinated the deployment of the new infrastructure updates across all agent systems.",
        "Sagan's literature review on neural network architectures was completed and shared with the team.",
        "The team meeting is scheduled for 3 PM tomorrow in the main conference room.",
        "Sagan completed the comparative analysis of different LLM providers for the research task.",
        "Hemingway drafted the marketing copy for the new product launch campaign.",
        "Sagan finished the data collection phase for the renewable energy study.",
        "Jonny created the visual direction for the upcoming product presentation."
    ]
    
    try:
        # Test basic reranking
        print("\n1. Testing basic reranking (top 5)...")
        results = rerank(query, passages, top_n=5)
        
        print(f"Returned {len(results)} results:")
        for i, result in enumerate(results):
            print(f"  {i+1}. Score: {result['score']:.4f}")
            print(f"     Passage: {result['passage'][:80]}...")
        
        # Verify ordering (scores should be descending)
        scores = [result['score'] for result in results]
        is_descending = all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
        print(f"\nScores in descending order: {is_descending}")
        
        # Test with top_n=3
        print("\n2. Testing top_n=3...")
        results_top3 = rerank(query, passages, top_n=3)
        print(f"Returned {len(results_top3)} results:")
        for i, result in enumerate(results_top3):
            print(f"  {i+1}. Score: {result['score']:.4f}")
        
        # Test with empty passages
        print("\n3. Testing empty passages...")
        empty_results = rerank("test query", [], top_n=5)
        print(f"Empty passages result: {empty_results}")
        
        # Test with None top_n (should return all)
        print("\n4. Testing None top_n (return all)...")
        all_results = rerank(query, passages[:3], top_n=None)
        print(f"Returned {len(all_results)} results (expected 3)")
        
        print("\n✓ All tests completed successfully!")
        return True
        
    except Exception as e:
        print(f"\n✗ Test failed with error: {e}")
        return False


if __name__ == "__main__":
    success = test_reranker()
    sys.exit(0 if success else 1)