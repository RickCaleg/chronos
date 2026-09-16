use anyhow::{anyhow, Result};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};

/// Parses the same flexible formats the desktop app accepts when typing a
/// date/time: `now`, `yyyy-MM-dd HH:mm[:ss]`, or just `HH:mm[:ss]` for today
/// (in the local timezone). Also accepts a full RFC 3339 timestamp for
/// scripting convenience. Returns UTC.
pub fn parse_datetime(input: &str) -> Result<DateTime<Utc>> {
    let trimmed = input.trim();

    if trimmed.eq_ignore_ascii_case("now") {
        return Ok(Utc::now());
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&Utc));
    }

    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(trimmed, fmt) {
            return local_to_utc(naive);
        }
    }

    for fmt in ["%H:%M:%S", "%H:%M"] {
        if let Ok(time) = NaiveTime::parse_from_str(trimmed, fmt) {
            let today = Local::now().date_naive();
            return local_to_utc(NaiveDateTime::new(today, time));
        }
    }

    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return local_to_utc(NaiveDateTime::new(date, NaiveTime::MIN));
    }

    Err(anyhow!(
        "couldn't parse \"{trimmed}\" as a date/time (try \"now\", \"2026-01-31 14:30\", or just \"14:30\")"
    ))
}

fn local_to_utc(naive: NaiveDateTime) -> Result<DateTime<Utc>> {
    match Local.from_local_datetime(&naive).single() {
        Some(dt) => Ok(dt.with_timezone(&Utc)),
        None => Err(anyhow!("ambiguous or invalid local time")),
    }
}

/// Formats a timestamp the same way `Date.prototype.toISOString()` does in
/// the desktop app's frontend, so rows written by the CLI are indistinguishable.
pub fn to_iso(dt: DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn now_iso() -> String {
    to_iso(Utc::now())
}

fn parse_iso(iso: &str) -> Result<DateTime<Utc>> {
    Ok(DateTime::parse_from_rfc3339(iso)?.with_timezone(&Utc))
}

pub fn duration_between(start_iso: &str, end_iso: &str) -> Result<i64> {
    let start = parse_iso(start_iso)?;
    let end = parse_iso(end_iso)?;
    Ok((end - start).num_seconds().max(0))
}

pub fn add_seconds(iso: &str, seconds: i64) -> Result<String> {
    let dt = parse_iso(iso)? + chrono::Duration::seconds(seconds);
    Ok(to_iso(dt))
}

/// Local display for table output, e.g. "2026-09-16 14:30".
pub fn format_local(iso: &str) -> String {
    match parse_iso(iso) {
        Ok(dt) => dt.with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string(),
        Err(_) => iso.to_string(),
    }
}

pub fn local_day_range_utc(date: NaiveDate) -> Result<(String, String)> {
    let start = local_to_utc(NaiveDateTime::new(date, NaiveTime::MIN))?;
    let end = local_to_utc(NaiveDateTime::new(
        date + chrono::Duration::days(1),
        NaiveTime::MIN,
    ))?;
    Ok((to_iso(start), to_iso(end)))
}

pub fn today_local() -> NaiveDate {
    Local::now().date_naive()
}

/// Parses "1:30:00", "1:30", or a plain number of minutes into whole seconds.
pub fn parse_duration_input(text: &str) -> Result<i64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("empty duration"));
    }
    let parts: Vec<&str> = trimmed.split(':').collect();
    let nums: Result<Vec<i64>> = parts
        .iter()
        .map(|p| p.trim().parse::<i64>().map_err(|_| anyhow!("invalid duration \"{trimmed}\"")))
        .collect();
    let nums = nums?;

    match nums.len() {
        3 => Ok(nums[0] * 3600 + nums[1] * 60 + nums[2]),
        2 => Ok(nums[0] * 3600 + nums[1] * 60),
        1 => Ok(nums[0] * 60),
        _ => Err(anyhow!("invalid duration \"{trimmed}\"")),
    }
}

pub fn format_duration_human(total_seconds: i64) -> String {
    let s = total_seconds.max(0);
    let h = s / 3600;
    let m = (s % 3600) / 60;
    if h == 0 && m == 0 {
        format!("{}s", s % 60)
    } else if h == 0 {
        format!("{m}m")
    } else {
        format!("{h}h {m:02}m")
    }
}

pub fn format_duration_hms(total_seconds: i64) -> String {
    let s = total_seconds.max(0);
    format!("{}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
}
