#!/bin/bash

# Mission Control Phase 3: Agent Heartbeat Script
# Called by OpenClaw cron every 15 minutes to wake agents and check for work
#
# Usage:
#   scripts/agent-heartbeat.sh [agent_name]
#
# If no agent specified, checks all agents with session keys

set -e

# Configuration
MISSION_CONTROL_URL="${MISSION_CONTROL_URL:-http://localhost:3005}"
LOG_DIR="${LOG_DIR:-$HOME/.mission-control/logs}"
LOG_FILE="$LOG_DIR/agent-heartbeat-$(date +%Y-%m-%d).log"
MAX_CONCURRENT=3  # Max agents to check concurrently
OPENCLAW_CMD="${OPENCLAW_CMD:-openclaw}"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging function
log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" | tee -a "$LOG_FILE"
}

# Check if Mission Control is running
check_mission_control() {
    if ! curl -s "$MISSION_CONTROL_URL/api/status" > /dev/null 2>&1; then
        log "ERROR" "Mission Control not accessible at $MISSION_CONTROL_URL"
        return 1
    fi
    return 0
}

# Check heartbeat for specific agent
check_agent_heartbeat() {
    local agent_name="$1"
    local agent_id="$2"
    
    log "INFO" "Checking heartbeat for agent: $agent_name"
    
    # Call heartbeat endpoint
    local response
    response=$(curl -s -w "HTTP_STATUS:%{http_code}" "$MISSION_CONTROL_URL/api/agents/$agent_id/heartbeat" 2>/dev/null)
    
    local http_code
    http_code=$(echo "$response" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
    local body
    body=$(echo "$response" | sed 's/HTTP_STATUS:[0-9]*$//')
    
    if [[ "$http_code" != "200" ]]; then
        log "ERROR" "Heartbeat failed for $agent_name: HTTP $http_code"
        return 1
    fi
    
    # Parse response
    local status
    status=$(echo "$body" | jq -r '.status // "unknown"' 2>/dev/null || echo "parse_error")
    
    if [[ "$status" == "HEARTBEAT_OK" ]]; then
        log "INFO" "Agent $agent_name: No work items found"
        return 0
    elif [[ "$status" == "WORK_ITEMS_FOUND" ]]; then
        local total_items
        total_items=$(echo "$body" | jq -r '.total_items // 0' 2>/dev/null || echo "0")
        log "INFO" "Agent $agent_name: Found $total_items work items"
        
        # If work items found and agent has session key, send wake notification
        local session_key
        session_key=$(get_agent_session_key "$agent_name")
        
        if [[ -n "$session_key" && "$session_key" != "null" ]]; then
            send_wake_notification "$agent_name" "$session_key" "$total_items" "$body"
        else
            log "WARN" "Agent $agent_name has work items but no session key configured"
        fi
        
        return 0
    else
        log "ERROR" "Unexpected heartbeat response for $agent_name: $status"
        return 1
    fi
}

# Get agent session key from database
get_agent_session_key() {
    local agent_name="$1"
    
    # Query agents API to get session key
    local agent_data
    agent_data=$(curl -s "$MISSION_CONTROL_URL/api/agents?limit=100" 2>/dev/null | jq -r ".agents[] | select(.name == \"$agent_name\") | .session_key" 2>/dev/null || echo "")
    
    echo "$agent_data"
}

# Send wake notification to agent session
send_wake_notification() {
    local agent_name="$1"
    local session_key="$2"
    local work_items_count="$3"
    local heartbeat_data="$4"
    
    log "INFO" "Sending wake notification to $agent_name (session: $session_key)"
    
    # Format wake message
    local wake_message="🤖 **Mission Control Heartbeat**\n\n"
    wake_message+="Agent: $agent_name\n"
    wake_message+="Work items found: $work_items_count\n\n"
    wake_message+="🔔 You have notifications or tasks that need attention.\n"
    wake_message+="Use Mission Control to view details: $MISSION_CONTROL_URL\n\n"
    wake_message+="⏰ $(date '+%Y-%m-%d %H:%M:%S')"
    
    # Send via OpenClaw sessions_send
    if "$OPENCLAW_CMD" gateway sessions_send --session "$session_key" --message "$wake_message" >> "$LOG_FILE" 2>&1; then
        log "INFO" "Wake notification sent successfully to $agent_name"
    else
        log "ERROR" "Failed to send wake notification to $agent_name"
    fi
}

# Get list of agents to check
get_agents_to_check() {
    local filter_agent="$1"
    
    if [[ -n "$filter_agent" ]]; then
        # Check specific agent
        echo "$filter_agent"
        return
    fi
    
    # Get all agents with session keys
    curl -s "$MISSION_CONTROL_URL/api/agents?limit=100" 2>/dev/null | \
        jq -r '.agents[] | select(.session_key != null and .session_key != "") | .name' 2>/dev/null || \
        echo ""
}

# Main execution
main() {
    local target_agent="$1"
    
    log "INFO" "Starting agent heartbeat check (PID: $$)"
    
    # Check if Mission Control is running
    if ! check_mission_control; then
        log "ERROR" "Aborting: Mission Control not accessible"
        exit 1
    fi
    
    # Get agents to check
    local agents
    agents=$(get_agents_to_check "$target_agent")
    
    if [[ -z "$agents" ]]; then
        log "WARN" "No agents found with session keys configured"
        exit 0
    fi
    
    local total_agents
    total_agents=$(echo "$agents" | wc -l)
    log "INFO" "Checking heartbeat for $total_agents agent(s)"
    
    # Process agents (limit concurrency)
    local processed=0
    local successful=0
    local failed=0
    local pids=()
    
    while IFS= read -r agent_name; do
        [[ -z "$agent_name" ]] && continue
        
        # Wait if we've reached max concurrent processes
        while [[ ${#pids[@]} -ge $MAX_CONCURRENT ]]; do
            for i in "${!pids[@]}"; do
                if ! kill -0 "${pids[$i]}" 2>/dev/null; then
                    unset "pids[$i]"
                fi
            done
            pids=("${pids[@]}") # Reindex array
            
            if [[ ${#pids[@]} -ge $MAX_CONCURRENT ]]; then
                sleep 1
            fi
        done
        
        # Start heartbeat check in background
        (
            if check_agent_heartbeat "$agent_name" "$agent_name"; then
                echo "SUCCESS:$agent_name"
            else
                echo "FAILED:$agent_name"
            fi
        ) &
        
        pids+=($!)
        ((processed++))
    done <<< "$agents"
    
    # Wait for all background processes
    for pid in "${pids[@]}"; do
        if wait "$pid"; then
            ((successful++))
        else
            ((failed++))
        fi
    done
    
    log "INFO" "Heartbeat check completed: $processed processed, $successful successful, $failed failed"
    
    # Return appropriate exit code
    if [[ $failed -gt 0 ]]; then
        exit 1
    else
        exit 0
    fi
}

# Handle script arguments
case "${1:-}" in
    --help|-h)
        echo "Mission Control Agent Heartbeat Script"
        echo ""
        echo "Usage: $0 [agent_name]"
        echo ""
        echo "Options:"
        echo "  agent_name    Check specific agent only"
        echo "  --help, -h    Show this help message"
        echo ""
        echo "Environment variables:"
        echo "  MISSION_CONTROL_URL  Mission Control base URL (default: http://localhost:3005)"
        echo ""
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac
