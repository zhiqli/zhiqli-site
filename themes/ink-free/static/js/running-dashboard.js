"use strict";

(function () {
    const dashboard = document.querySelector("[data-running-dashboard]");
    if (!dashboard) return;

    const sourceUrl = dashboard.dataset.sourceUrl;
    const fallbackUrls = [
        sourceUrl,
        "https://zhiqli.github.io/running_page/activities.json",
        "https://zhiqli.github.io/running_page/static/activities.json",
        "https://zhiqli.github.io/running_page/src/static/activities.json",
        "https://raw.githubusercontent.com/zhiqli/running_page/main/src/static/activities.json",
        "https://raw.githubusercontent.com/zhiqli/running_page/master/src/static/activities.json",
    ].filter(Boolean);

    const $ = (selector) => dashboard.querySelector(selector);
    let renderedActivities = [];
    let visibleActivityCount = 12;

    const setText = (selector, value) => {
        const el = $(selector);
        if (el) el.textContent = value;
    };

    const formatKm = (value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
    const pad = (n) => String(n).padStart(2, "0");

    function parseDate(activity) {
        const raw = activity.start_date_local || activity.start_date || activity.date || activity.begin_datetime;
        const date = raw ? new Date(String(raw).replace(" ", "T")) : null;
        return date && !Number.isNaN(date.getTime()) ? date : null;
    }

    function parseSeconds(value) {
        if (typeof value === "number") return value;
        if (!value) return 0;
        const text = String(value);
        const match = text.match(/(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
        if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const asNumber = Number(text);
        return Number.isFinite(asNumber) ? asNumber : 0;
    }

    function normalizeDistance(value) {
        const distance = Number(value || 0);
        if (!Number.isFinite(distance)) return 0;
        return distance > 300 ? distance / 1000 : distance;
    }

    function normalizeActivity(activity) {
        const date = parseDate(activity);
        const distanceKm = normalizeDistance(activity.distance || activity.total_distance || activity.dis);
        const seconds = parseSeconds(activity.moving_time || activity.elapsed_time || activity.duration);
        return {
            name: activity.name || activity.title || activity.type || "Run",
            date,
            distanceKm,
            seconds,
            paceSeconds: distanceKm > 0 && seconds > 0 ? seconds / distanceKm : 0,
            polyline: activity.summary_polyline || activity.polyline || activity.map?.summary_polyline || "",
        };
    }

    function formatDuration(seconds) {
        if (!seconds) return "--";
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
    }

    function formatPace(seconds) {
        if (!seconds) return "--";
        return `${Math.floor(seconds / 60)}'${pad(Math.round(seconds % 60))}" /km`;
    }

    function dayKey(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    }

    function computeBestStreak(activities) {
        const days = [...new Set(activities.filter((a) => a.date).map((a) => dayKey(a.date)))].sort();
        let best = 0;
        let current = 0;
        let previous = null;
        days.forEach((key) => {
            const date = new Date(`${key}T00:00:00`);
            if (previous && (date - previous) / 86400000 === 1) {
                current += 1;
            } else {
                current = 1;
            }
            best = Math.max(best, current);
            previous = date;
        });
        return best;
    }

    function renderCalendars(activities, yearTotals) {
        const target = $("[data-running-calendar]");
        if (!target) return;

        const years = [...new Set(activities.filter((activity) => activity.date).map((activity) => activity.date.getFullYear()))].sort((a, b) => b - a);
        const maxYearTotal = Math.max(...[...yearTotals.values()], 1);
        const html = years.map((year) => renderYearCalendar(activities, year, maxYearTotal)).join("");
        target.innerHTML = html;
    }

    function renderYearCalendar(activities, year, maxYearTotal) {
        const yearActivities = activities.filter((activity) => activity.date && activity.date.getFullYear() === year);
        const daily = new Map();
        let yearTotal = 0;
        yearActivities.forEach((activity) => {
            const key = dayKey(activity.date);
            daily.set(key, (daily.get(key) || 0) + activity.distanceKm);
            yearTotal += activity.distanceKm;
        });

        const start = new Date(`${year}-01-01T00:00:00`);
        const end = new Date(`${year}-12-31T00:00:00`);
        const cells = [];
        const leading = start.getDay();
        for (let i = 0; i < leading; i += 1) {
            cells.push('<span class="calendar-cell calendar-empty"></span>');
        }

        let maxDay = 0;
        daily.forEach((value) => {
            maxDay = Math.max(maxDay, value);
        });

        for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
            const key = dayKey(date);
            const distance = daily.get(key) || 0;
            const level = distance === 0 ? 0 : Math.max(1, Math.ceil((distance / Math.max(maxDay, 1)) * 4));
            cells.push(`<span class="calendar-cell level-${level}" title="${key}: ${distance ? formatKm(distance) : "0 km"}"></span>`);
        }

        const yearWidth = Math.max(4, (yearTotal / Math.max(maxYearTotal, 1)) * 100).toFixed(2);
        const totalWeeks = Math.ceil((leading + cells.length - leading) / 7);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthLabels = Array.from({ length: 12 }, (_, index) => {
            const monthStart = new Date(year, index, 1);
            const dayIndex = Math.floor((monthStart - start) / 86400000);
            const week = Math.floor((leading + dayIndex) / 7) + 1;
            return `<span style="grid-column:${week}">${monthNames[index]}</span>`;
        }).join("");

        return `
            <div class="running-calendar-year">
                <div class="running-calendar-year-label">
                    <span>${year}</span>
                    <em aria-hidden="true"><i style="width:${yearWidth}%"></i></em>
                    <strong>${formatKm(yearTotal)}</strong>
                </div>
                <div class="running-calendar-wrap">
                    <div class="running-calendar-weekdays" aria-hidden="true">
                        <span>Mon</span>
                        <span>Wed</span>
                        <span>Fri</span>
                    </div>
                    <div class="running-calendar-body" style="--running-weeks:${totalWeeks}">
                        <div class="running-calendar-months" aria-hidden="true">${monthLabels}</div>
                        <div class="running-calendar">${cells.join("")}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function renderTable() {
        const target = $("[data-running-table]");
        const more = $("[data-running-load-more]");
        if (!target) return;
        const visible = renderedActivities.slice(0, visibleActivityCount);
        target.innerHTML = visible.map((activity) => `
            <tr>
                <td>${activity.date ? dayKey(activity.date) : "--"}</td>
                <td>${activity.name}</td>
                <td>${formatKm(activity.distanceKm)}</td>
                <td>${formatDuration(activity.seconds)}</td>
                <td>${formatPace(activity.paceSeconds)}</td>
            </tr>
        `).join("");

        if (more) {
            const hasMore = visibleActivityCount < renderedActivities.length;
            more.hidden = !hasMore;
            more.textContent = hasMore ? `加载更多（${renderedActivities.length - visibleActivityCount}）` : "已全部加载";
        }
    }

    function setupLoadMore() {
        const more = $("[data-running-load-more]");
        if (!more || more.dataset.bound === "true") return;
        more.dataset.bound = "true";
        more.addEventListener("click", () => {
            visibleActivityCount += 12;
            renderTable();
            setText("[data-running-recent-count]", `${Math.min(visibleActivityCount, renderedActivities.length)} / ${renderedActivities.length}`);
        });
    }

    function render(raw) {
        const list = Array.isArray(raw) ? raw : raw.activities || raw.runs || raw.data || [];
        const activities = list
            .map(normalizeActivity)
            .filter((activity) => activity.distanceKm > 0)
            .sort((a, b) => (b.date || 0) - (a.date || 0));

        if (!activities.length) throw new Error("activities.json 中没有可用跑步记录");
        renderedActivities = activities;
        visibleActivityCount = 12;

        const total = activities.reduce((sum, activity) => sum + activity.distanceKm, 0);
        const totalSeconds = activities.reduce((sum, activity) => sum + activity.seconds, 0);
        const latest = activities[0];
        const latestYear = latest.date ? latest.date.getFullYear() : null;
        const latestMonth = latest.date ? monthKey(latest.date) : null;
        const yearTotals = new Map();
        const monthTotals = new Map();

        activities.forEach((activity) => {
            if (!activity.date) return;
            const year = activity.date.getFullYear();
            const month = monthKey(activity.date);
            yearTotals.set(year, (yearTotals.get(year) || 0) + activity.distanceKm);
            monthTotals.set(month, (monthTotals.get(month) || 0) + activity.distanceKm);
        });

        setText("[data-running-total]", formatKm(total));
        setText("[data-running-year]", latestYear ? formatKm(yearTotals.get(latestYear) || 0) : "-- km");
        setText("[data-running-month]", latestMonth ? formatKm(monthTotals.get(latestMonth) || 0) : "-- km");
        setText("[data-running-pace]", formatPace(totalSeconds / total));
        setText("[data-running-recent-count]", `${Math.min(visibleActivityCount, activities.length)} / ${activities.length}`);

        renderCalendars(activities, yearTotals);
        setupLoadMore();
        renderTable();
    }

    async function load() {
        let lastError = null;
        for (const url of fallbackUrls) {
            try {
                const response = await fetch(url, { cache: "no-store" });
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                const data = await response.json();
                render(data);
                return;
            } catch (error) {
                lastError = error;
            }
        }
        const table = $("[data-running-table]");
        if (table) table.innerHTML = '<tr><td colspan="5">无法读取 zhiqli/running_page 的 activities.json。</td></tr>';
    }

    load();
})();
