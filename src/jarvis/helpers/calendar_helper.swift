#!/usr/bin/env swift
// Fast calendar reader using EventKit — bypasses slow AppleScript
import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

store.requestFullAccessToEvents { granted, error in
    defer { semaphore.signal() }

    guard granted else {
        print("ERROR:Calendar access denied")
        return
    }

    let calendar = Calendar.current
    let command = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "today"

    switch command {
    case "today":
        let start = calendar.startOfDay(for: Date())
        let end = calendar.date(byAdding: .day, value: 1, to: start)!
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }

        for event in events {
            let formatter = DateFormatter()
            formatter.dateFormat = "h:mm a"
            let timeStr = event.isAllDay ? "ALL_DAY" : formatter.string(from: event.startDate)
            let endStr = event.isAllDay ? "ALL_DAY" : formatter.string(from: event.endDate)
            let location = event.location ?? ""
            let calName = event.calendar.title
            print("\(calName)|||\(event.title ?? "")|||\(timeStr)|||\(endStr)|||\(location)|||\(event.isAllDay)")
        }

    case "upcoming":
        let hours = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2]) ?? 4 : 4
        let start = Date()
        let end = calendar.date(byAdding: .hour, value: hours, to: start)!
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: nil)
        let events = store.events(matching: predicate).sorted { $0.startDate < $1.startDate }

        for event in events {
            let formatter = DateFormatter()
            formatter.dateFormat = "h:mm a"
            let timeStr = event.isAllDay ? "ALL_DAY" : formatter.string(from: event.startDate)
            let calName = event.calendar.title
            print("\(calName)|||\(event.title ?? "")|||\(timeStr)")
        }

    case "calendars":
        for cal in store.calendars(for: .event) {
            print(cal.title)
        }

    default:
        print("Usage: calendar_helper [today|upcoming|calendars]")
    }
}

semaphore.wait()
