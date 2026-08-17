/**
 * calendar-connector.ts
 * Generates downloadable .ics calendar events from natural language.
 * Exports valid iCalendar format that works with Google Calendar, Outlook, Apple Calendar.
 */

import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const ollamaBaseUrl = (process.env.OLLAMA_URL || "http://ollama:11434").replace(/\/$/, "");
const textModel = process.env.OLLAMA_TEXT_MODEL || "qwen2.5:14b-instruct";

export interface CalendarEvent {
  title: string;
  description?: string;
  location?: string;
  startDate: string; // ISO 8601
  endDate: string;
  allDay?: boolean;
  recurrence?: string;
  reminders?: number[]; // minutes before
}

export interface CalendarResult {
  events: CalendarEvent[];
  icsContent: string;
  summary: string;
}

function toIcsDate(iso: string, allDay = false): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    // Fall back to tomorrow noon
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);
    if (allDay) {
      return tomorrow.toISOString().slice(0, 10).replace(/-/g, "");
    }
    return tomorrow.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  }
  if (allDay) {
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
}

function generateIcs(events: CalendarEvent[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cloud9 AI//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const uid = uuidv4();
    const isAllDay = event.allDay ?? false;

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`SUMMARY:${event.title}`);

    if (isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${toIcsDate(event.startDate, true)}`);
      lines.push(`DTEND;VALUE=DATE:${toIcsDate(event.endDate, true)}`);
    } else {
      lines.push(`DTSTART:${toIcsDate(event.startDate)}`);
      lines.push(`DTEND:${toIcsDate(event.endDate)}`);
    }

    if (event.description) {
      lines.push(`DESCRIPTION:${event.description.replace(/\n/g, "\\n")}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${event.location}`);
    }
    if (event.recurrence) {
      lines.push(`RRULE:${event.recurrence}`);
    }

    // Alarms/reminders
    for (const minutes of event.reminders || [15]) {
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT" + minutes + "M");
      lines.push("ACTION:DISPLAY");
      lines.push(`DESCRIPTION:Reminder: ${event.title}`);
      lines.push("END:VALARM");
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function runCalendarTool(
  request: string,
  fileContext: string
): Promise<CalendarResult> {
  const contextSection = fileContext ? `\n\nContext:\n${fileContext}` : "";
  const currentDate = new Date().toISOString();

  const prompt = `You are a scheduling assistant. Current date/time: ${currentDate}${contextSection}

User request: ${request}

Extract all events/tasks/deadlines from the request and return them as valid JSON array.
Each event MUST follow this exact shape:
[{
  "title": "Event title",
  "description": "Optional description",
  "location": "Optional location",
  "startDate": "ISO 8601 datetime e.g. 2026-08-20T10:00:00Z",
  "endDate": "ISO 8601 datetime e.g. 2026-08-20T11:00:00Z",
  "allDay": false,
  "recurrence": "FREQ=WEEKLY;BYDAY=MO or empty string",
  "reminders": [15, 60]
}]

Return ONLY the JSON array. No markdown. No explanation.`;

  const response = await axios.post(
    `${ollamaBaseUrl}/api/generate`,
    { model: textModel, prompt, stream: false },
    { timeout: 90_000 }
  );

  let raw = (response.data?.response as string || "").trim();
  raw = raw.replace(/^```json\n?/i, "").replace(/^```\n?/, "").replace(/```$/, "").trim();

  let events: CalendarEvent[] = [];
  try {
    events = JSON.parse(raw);
    if (!Array.isArray(events)) events = [events];
  } catch {
    // Create a single generic event as fallback
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(11, 0, 0, 0);

    events = [{
      title: request.slice(0, 80),
      startDate: tomorrow.toISOString(),
      endDate: tomorrowEnd.toISOString(),
      reminders: [15],
    }];
  }

  const icsContent = generateIcs(events);
  const summary = events.length === 1
    ? `Created 1 calendar event: "${events[0].title}"`
    : `Created ${events.length} calendar events`;

  return { events, icsContent, summary };
}
