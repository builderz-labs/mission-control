#!/bin/bash
# Fast calendar event fetcher - runs per-calendar queries in parallel with timeout
# Output format: CALENDAR|||SUMMARY|||TIME|||ALL_DAY

# Use CALENDAR_ACCOUNTS env var (comma-separated) or auto-discover all calendars
if [ -n "$CALENDAR_ACCOUNTS" ]; then
    IFS=',' read -ra CALS <<< "$CALENDAR_ACCOUNTS"
else
    # Auto-discover all calendars from Apple Calendar
    IFS=',' read -ra CALS <<< "$(osascript -e 'tell application "Calendar" to return name of every calendar' 2>/dev/null)"
    # Trim whitespace
    for i in "${!CALS[@]}"; do CALS[$i]=$(echo "${CALS[$i]}" | xargs); done
fi

if [ ${#CALS[@]} -eq 0 ]; then
    echo "No calendars found. Set CALENDAR_ACCOUNTS env var." >&2
    exit 1
fi

fetch_cal() {
    local cal="$1"
    osascript -e "
tell application \"Calendar\"
    set cal to calendar \"$cal\"
    set allStarts to start date of every event of cal
    set allSummaries to summary of every event of cal
    set allAllDay to allday event of every event of cal
    set todayStart to current date
    set time of todayStart to 0
    set todayEnd to todayStart + (1 * days)
    set output to \"\"
    repeat with i from 1 to count of allStarts
        set s to item i of allStarts
        if s >= todayStart and s < todayEnd then
            set h to hours of s
            set m to minutes of s
            if item i of allAllDay then
                set timeStr to \"ALL_DAY\"
            else
                if h > 12 then
                    set timeStr to ((h - 12) as string) & \":\" & (text -2 thru -1 of (\"0\" & m)) & \" PM\"
                else if h = 0 then
                    set timeStr to \"12:\" & (text -2 thru -1 of (\"0\" & m)) & \" AM\"
                else if h = 12 then
                    set timeStr to \"12:\" & (text -2 thru -1 of (\"0\" & m)) & \" PM\"
                else
                    set timeStr to (h as string) & \":\" & (text -2 thru -1 of (\"0\" & m)) & \" AM\"
                end if
            end if
            set output to output & \"$cal\" & \"|||\" & item i of allSummaries & \"|||\" & timeStr & \"|||\" & item i of allAllDay & linefeed
        end if
    end repeat
    return output
end tell
" 2>/dev/null
}

# Run all in parallel with 6s timeout each
for cal in "${CALS[@]}"; do
    ( timeout 6 bash -c "$(declare -f fetch_cal); fetch_cal '$cal'" ) &
done

wait
