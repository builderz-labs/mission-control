#!/bin/bash

# Mission Control Phase 3: Notification Delivery Daemon
# Polls undelivered notifications and sends them to agent sessions via OpenClaw
#
# Usage:
#   scripts/notification-daemon.sh [options]
#
# Options:
#   --agent AGENT_NAME    Only deliver notifications to specific agent
#   --limit N             Max notifications to process per batch (default: 50)
#   --dry-run            Test mode - don't actually deliver notifications
#   --daemon             Run in daemon mode (continuous polling)
#   --interval SECONDS   Polling interval in daemon mode (default: 60)

set -e

# Configuration
MISSION_CONTROL_URL="http://localhost:3004"
LOG_DIR="/home/ubuntu/clawd/.ralph/logs"
LOG_FILE="$LOG_DIR/notification-daemon-$(date +%Y-%m-%d).log"
PID_FILE="/tmp/notification-daemon.pid"
DEFAULT_INTERVAL=60
DEFAULT_LIMIT=50

# Command line options
AGENT_FILTER=""
LIMIT=$DEFAULT_LIMIT
DRY_RUN=false
DAEMON_MODE=false
INTERVAL=$DEFAULT_INTERVAL

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

# Process and deliver notifications
deliver_notifications() {
    log "INFO" "Starting notification delivery batch"
    
    # Build API request
    local api_payload="{\"limit\": $LIMIT"
    
    if [[ -n "$AGENT_FILTER" ]]; then
        api_payload+=", \"agent_filter\": \"$AGENT_FILTER\""
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        api_payload+=", \"dry_run\": true"
    fi
    
    api_payload+="}"
    
    # Call notification delivery endpoint
    local response
    response=$(curl -s -w "HTTP_STATUS:%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$api_payload" \
        "$MISSION_CONTROL_URL/api/notifications/deliver" 2>/dev/null)
    
    local http_code
    http_code=$(echo "$response" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
    local body
    body=$(echo "$response" | sed 's/HTTP_STATUS:[0-9]*$//')
    
    if [[ "$http_code" != "200" ]]; then
        log "ERROR" "Notification delivery failed: HTTP $http_code"
        log "ERROR" "Response: $body"
        return 1
    fi
    
    # Parse results
    local status delivered errors total_processed
    status=$(echo "$body" | jq -r '.status // "unknown"' 2>/dev/null || echo "parse_error")
    delivered=$(echo "$body" | jq -r '.delivered // 0' 2>/dev/null || echo "0")
    errors=$(echo "$body" | jq -r '.errors // 0' 2>/dev/null || echo "0")
    total_processed=$(echo "$body" | jq -r '.total_processed // 0' 2>/dev/null || echo "0")
    
    if [[ "$status" == "success" ]]; then
        if [[ "$total_processed" -gt 0 ]]; then
            log "INFO" "Batch completed: $total_processed processed, $delivered delivered, $errors failed"
            
            # Log detailed errors if any
            if [[ "$errors" -gt 0 ]]; then
                local error_details
                error_details=$(echo "$body" | jq -r '.error_details[]? | "- \(.recipient): \(.error)"' 2>/dev/null || echo "")
                if [[ -n "$error_details" ]]; then
                    log "WARN" "Error details:"
                    echo "$error_details" | while read -r line; do
                        log "WARN" "  $line"
                    done
                fi
            fi
        else
            log "INFO" "No notifications to deliver"
        fi
        
        return 0
    else
        log "ERROR" "Unexpected delivery response: $status"
        return 1
    fi
}

# Get delivery statistics
get_delivery_stats() {
    local stats_url="$MISSION_CONTROL_URL/api/notifications/deliver"
    
    if [[ -n "$AGENT_FILTER" ]]; then
        stats_url+="?agent=$AGENT_FILTER"
    fi
    
    local response
    response=$(curl -s "$stats_url" 2>/dev/null)
    
    if [[ $? -eq 0 ]]; then
        echo "$response" | jq -r '
            "Delivery Statistics:",
            "  Total notifications: \(.statistics.total)",
            "  Delivered: \(.statistics.delivered)",
            "  Undelivered: \(.statistics.undelivered)",
            "  Delivery rate: \(.statistics.delivery_rate)%",
            "",
            "Agents with pending notifications:",
            (.agents_with_pending[] | "  \(.recipient): \(.pending_count) pending\(if .session_key then "" else " (no session key)" end)")
        ' 2>/dev/null || echo "Failed to parse statistics"
    else
        echo "Failed to fetch delivery statistics"
    fi
}

# Daemon mode signal handlers
cleanup() {
    log "INFO" "Received shutdown signal, stopping daemon"
    rm -f "$PID_FILE"
    exit 0
}

# Check if daemon is already running
check_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        local old_pid
        old_pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
        
        if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
            log "ERROR" "Notification daemon already running with PID $old_pid"
            exit 1
        else
            log "WARN" "Stale PID file found, removing"
            rm -f "$PID_FILE"
        fi
    fi
}

# Run in daemon mode
run_daemon() {
    log "INFO" "Starting notification daemon (PID: $$)"
    
    # Check if already running
    check_daemon
    
    # Write PID file
    echo $$ > "$PID_FILE"
    
    # Set up signal handlers
    trap cleanup SIGTERM SIGINT SIGQUIT
    
    # Main daemon loop
    while true; do
        if ! check_mission_control; then
            log "WARN" "Mission Control not accessible, sleeping $INTERVAL seconds"
            sleep "$INTERVAL"
            continue
        fi
        
        # Process notifications
        if deliver_notifications; then
            log "DEBUG" "Delivery batch completed successfully"
        else
            log "WARN" "Delivery batch had errors"
        fi
        
        # Sleep until next cycle
        sleep "$INTERVAL"
    done
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --agent)
                AGENT_FILTER="$2"
                shift 2
                ;;
            --limit)
                LIMIT="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --daemon)
                DAEMON_MODE=true
                shift
                ;;
            --interval)
                INTERVAL="$2"
                shift 2
                ;;
            --stats)
                get_delivery_stats
                exit 0
                ;;
            --stop)
                if [[ -f "$PID_FILE" ]]; then
                    local pid
                    pid=$(cat "$PID_FILE" 2>/dev/null || echo "")
                    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
                        kill -TERM "$pid"
                        log "INFO" "Sent stop signal to daemon (PID: $pid)"
                        exit 0
                    else
                        log "WARN" "No running daemon found"
                        rm -f "$PID_FILE"
                        exit 1
                    fi
                else
                    log "WARN" "No daemon PID file found"
                    exit 1
                fi
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1" >&2
                show_help
                exit 1
                ;;
        esac
    done
}

# Show help
show_help() {
    cat << 'EOF'
Mission Control Notification Delivery Daemon

Usage: notification-daemon.sh [options]

Options:
  --agent AGENT_NAME      Only deliver notifications to specific agent
  --limit N              Max notifications to process per batch (default: 50)
  --dry-run              Test mode - don't actually deliver notifications
  --daemon               Run in daemon mode (continuous polling)
  --interval SECONDS     Polling interval in daemon mode (default: 60)
  --stats                Show delivery statistics and exit
  --stop                 Stop running daemon
  --help, -h             Show this help message

Examples:
  # Single batch delivery
  ./notification-daemon.sh

  # Dry run to test
  ./notification-daemon.sh --dry-run

  # Deliver only to specific agent
  ./notification-daemon.sh --agent "Jarv"

  # Run as daemon
  ./notification-daemon.sh --daemon --interval 30

  # Show statistics
  ./notification-daemon.sh --stats

  # Stop daemon
  ./notification-daemon.sh --stop

Environment variables:
  MISSION_CONTROL_URL    Mission Control base URL (default: http://localhost:3005)

Log files:
  $LOG_DIR/notification-daemon-YYYY-MM-DD.log
EOF
}

# Validate arguments
validate_args() {
    if ! [[ "$LIMIT" =~ ^[1-9][0-9]*$ ]]; then
        log "ERROR" "Invalid limit: $LIMIT (must be positive integer)"
        exit 1
    fi
    
    if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
        log "ERROR" "Invalid interval: $INTERVAL (must be positive integer)"
        exit 1
    fi
}

# Main execution
main() {
    parse_args "$@"
    validate_args
    
    if [[ "$DAEMON_MODE" == "true" ]]; then
        run_daemon
    else
        # Single run mode
        log "INFO" "Starting single notification delivery run"
        
        if ! check_mission_control; then
            log "ERROR" "Aborting: Mission Control not accessible"
            exit 1
        fi
        
        if deliver_notifications; then
            log "INFO" "Notification delivery completed successfully"
            exit 0
        else
            log "ERROR" "Notification delivery failed"
            exit 1
        fi
    fi
}

# Run main function
main "$@"