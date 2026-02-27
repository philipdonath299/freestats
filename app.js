/* ================================================
   app.js — SweHockey Live (Flashscore Edition)
   ================================================ */

const CONFIG = {
    CORS_PROXY: '/proxy/',
    LIVE_URL: 'https://stats.swehockey.se/ScheduleAndResults/Live/',
    SCHEDULE_URL: 'https://stats.swehockey.se/ScheduleAndResults/Schedule/',
    STANDINGS_URL: 'https://stats.swehockey.se/ScheduleAndResults/Standings/',
    STATS_URL: 'https://stats.swehockey.se/Players/Statistics/ScoringLeaders/',
    GOALIE_STATS_URL: 'https://stats.swehockey.se/Players/Statistics/LeadingGoaliesSVS/',
    EVENTS_URL: 'https://stats.swehockey.se/Game/Events/',
    LINEUPS_URL: 'https://stats.swehockey.se/Game/LineUps/',
    POLL_INTERVAL: 30000,
};

const $ = id => document.getElementById(id);

const UI = {
    // Header
    sidebarToggle: $('sidebar-toggle'),
    sidebar: $('sidebar'),
    sidebarOverlay: $('sidebar-overlay'),
    sidebarLeagues: $('sidebar-leagues'),
    leagueSelect: $('league-select'),
    refreshBtn: $('refresh-btn'),
    statusPill: $('status-pill'),
    statusDot: $('status-dot'),
    statusText: $('status-text'),
    lastUpdatedTime: $('last-updated-time'),
    themeBtn: $('theme-btn'),
    themeMoon: $('theme-moon'),
    themeSun: $('theme-sun'),
    notifyBtn: $('notify-btn'),
    searchWrap: $('search-wrap'),
    searchToggle: $('search-toggle-btn'),
    searchInput: $('search-input'),
    searchClear: $('search-clear-btn'),
    calendarBtn: $('calendar-btn'),
    calendarInput: $('calendar-input'),
    dateStrip: $('date-strip'),
    // Sections
    sectionGames: $('section-games'),
    sectionStandings: $('section-standings'),
    sectionStats: $('section-stats'),
    gamesContainer: $('games-container'),
    standingsBody: $('standings-body'),
    statsHeader: $('stats-header'),
    statsBody: $('stats-body'),
    errorContainer: $('error-container'),
    retryBtn: $('retry-btn'),
    // Filter
    liveBadge: $('live-badge'),
    bcLeague: $('bc-league'),
    bcStatsLeague: $('bc-stats-league'),
    // Stats sub-nav
    statsScorersBtn: $('stats-scorers-btn'),
    statsGoaliesBtn: $('stats-goalies-btn'),
    // Modal
    modal: $('game-modal'),
    modalBackdrop: $('modal-backdrop'),
    closeModal: $('close-modal-btn') || $('close-modal'),
    modalMatchHeader: $('modal-match-header'),
    modalBody: $('modal-body'),
    modalLineups: $('modal-lineups'),
    modalH2h: $('modal-h2h'),
    // Misc
    scrollTopBtn: $('scroll-top-btn'),
    // Templates
    gameRowTpl: $('game-row-template'),
    skelGameTpl: $('skeleton-game-template'),
    skelTableTpl: $('skeleton-table-template'),
};

// ── State ──────────────────────────────────────────────────────
let currentSection = 'games';
let currentFilter = 'all';         // all | live | scheduled | finished | favorites
let currentStatsTab = 'scorers';
let currentTheme = localStorage.getItem('fs-theme') || 'dark';
let currentDate = todayDate();
let pollTimer = null;
let fetchController = null;
let searchQuery = '';
let searchDebounce = null;
let standingsSort = { col: 'tp', asc: false };
let allScheduleGames = [];         // cached schedule for form+H2H
let prevScores = {};               // gameId → {home, away} for animation
let liveClockMap = {};             // gameId → {startTs, periodElapsed}
let clockInterval = null;
let watchedGames = new Set();
let favorites = new Set(JSON.parse(localStorage.getItem('fs-favs') || '[]'));
let modalGame = null;

// ── Date helpers ───────────────────────────────────────────────
function todayDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function isSameDay(a, b) { return a.toDateString() === b.toDateString(); }

function isToday(d) { return isSameDay(d, todayDate()); }

function dateLabel(d) {
    const t = todayDate();
    const yest = new Date(t); yest.setDate(t.getDate() - 1);
    const tom = new Date(t); tom.setDate(t.getDate() + 1);
    if (isSameDay(d, t)) return 'TODAY';
    if (isSameDay(d, yest)) return 'YEST';
    if (isSameDay(d, tom)) return 'TMR';
    return d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase();
}

function dateToYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Date strip ─────────────────────────────────────────────────
function buildDateStrip() {
    UI.dateStrip.innerHTML = '';
    for (let offset = -3; offset <= 3; offset++) {
        const d = new Date(todayDate());
        d.setDate(d.getDate() + offset);
        const btn = document.createElement('button');
        btn.className = `ds-btn${isSameDay(d, currentDate) ? ' active' : ''}`;
        btn.innerHTML = `<span class="ds-day">${dateLabel(d)}</span><span class="ds-num">${d.getDate()}</span>`;
        const dateCopy = new Date(d);
        btn.addEventListener('click', () => {
            currentDate = dateCopy;
            buildDateStrip();
            fetchData();
        });
        UI.dateStrip.appendChild(btn);
    }
}

// ── Sidebar ────────────────────────────────────────────────────
function buildSidebar() {
    const leagues = [
        { id: '18263', name: 'SHL', tier: 1 },
        { id: '18266', name: 'HockeyAllsvenskan', tier: 1 },
        { id: '18264', name: 'Hockeyettan', tier: 2 },
        { id: '20368', name: 'Tvåan Öst', tier: 3 },
        { id: '20221', name: 'Tvåan Norr', tier: 3 },
        { id: '19861', name: 'Trean Öst', tier: 4 },
        { id: '19918', name: 'Trean Syd', tier: 4 },
        { id: '20351', name: 'Trean Väst', tier: 4 },
        { id: '18570', name: 'Trean Norr', tier: 4 },
        { id: '20059', name: 'Fyran Stockholm', tier: 5 },
    ];
    UI.sidebarLeagues.innerHTML = leagues.map(l => `
        <button class="sb-league-btn${UI.leagueSelect.value === l.id ? ' active' : ''}" data-id="${l.id}">
            <span class="sb-flag">🇸🇪</span>
            <span class="sb-league-name">${l.name}</span>
            <span class="sb-tier">Tier ${l.tier}</span>
        </button>`).join('');
    UI.sidebarLeagues.querySelectorAll('.sb-league-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            UI.leagueSelect.value = btn.dataset.id;
            closeSidebar();
            fetchData();
            buildSidebar();
        });
    });
}

function openSidebar() {
    UI.sidebar.classList.remove('hidden');
    UI.sidebarOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}
function closeSidebar() {
    UI.sidebar.classList.add('hidden');
    UI.sidebarOverlay.classList.add('hidden');
    document.body.style.overflow = '';
}

UI.sidebarToggle.addEventListener('click', () =>
    UI.sidebar.classList.contains('hidden') ? openSidebar() : closeSidebar());
UI.sidebarOverlay.addEventListener('click', closeSidebar);

// ── Helpers ────────────────────────────────────────────────────
const decodeHTML = html => {
    const t = document.createElement('textarea');
    t.innerHTML = html;
    return t.value;
};
const proxy = url => CONFIG.CORS_PROXY + encodeURIComponent(url);
const saveFavs = () => localStorage.setItem('fs-favs', JSON.stringify([...favorites]));
const getLeagueName = id => UI.leagueSelect.querySelector(`option[value="${id}"]`)?.textContent || 'League';
const isLiveStatus = s => {
    const lo = s.toLowerCase();
    return lo.includes('period') || lo === 'live' || lo.includes('ot') || lo.includes('gws');
};

// ── Parser ─────────────────────────────────────────────────────
class Parser {
    static parseLive(html) {
        const games = [];
        try {
            const dec = decodeHTML(html);
            const blocks = dec.split('TodaysGamesGame');
            const seen = new Set();
            for (let i = 1; i < blocks.length; i++) {
                const b = blocks[i];
                const teams = [...b.matchAll(/class="h2[^>]*>([^<]+)/g)];
                if (teams.length < 2) continue;
                const home = teams[0][1].trim(), away = teams[1][1].trim();
                let raw = 'Scheduled';
                const rm = b.match(/class=[^>]*Result[^>]*>([\s\S]*?)<\/div>/);
                if (rm) raw = rm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                let id = null;
                const im = b.match(/\/Game\/(?:Events|GamePreview)\/(\d+)/i);
                if (im) id = im[1];
                const key = `${home}|${away}|${id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                games.push(Parser._proc(home, away, raw, id));
            }
        } catch (e) { console.error('parseLive', e); }
        return games;
    }

    static parseSchedule(html) {
        const games = [];
        try {
            const dec = decodeHTML(html);
            const rows = dec.split('<tr');
            let currentDateStr = '';
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) {
                    const dateMatch = row.match(/\d{4}-\d{2}-\d{2}/);
                    if (dateMatch) currentDateStr = dateMatch[0];
                    continue;
                }
                const cells = row.split('<td');
                if (cells.length < 5) continue;
                let home = '', away = '', raw = 'Scheduled', id = null;
                for (let j = 1; j < cells.length; j++) {
                    const content = cells[j].substring(cells[j].indexOf('>') + 1).split('</td')[0];
                    const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (text.match(/[^\d]\s*[-–]\s*[^\d]/) && !text.match(/^\d{4}-\d{2}-\d{2}$/) && !text.match(/^\d+\s*-\s*\d+$/)) {
                        const parts = text.split(/\s*[-–]\s*/);
                        if (parts.length >= 2) { home = parts[0]; away = parts[1]; }
                    }
                    if (cells[j].includes('openonlinewindow')) {
                        const im = cells[j].match(/\/Game\/Events\/(\d+)/);
                        if (im) id = im[1];
                        raw = text;
                    }
                }
                if (home && away) {
                    const game = Parser._proc(home, away, raw, id);
                    game.date = currentDateStr;
                    games.push(game);
                }
            }
        } catch (e) { console.error('parseSchedule', e); }
        return games;
    }

    static parseStandings(html) {
        const rows = [];
        try {
            const dec = decodeHTML(html);
            const parts = dec.split('<tr');
            for (let i = 1; i < parts.length; i++) {
                const row = parts[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
                const cells = row.split('<td');
                if (cells.length < 9) continue;
                const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                const rank = t(1), team = t(2);
                if (!team || team === 'Team') continue;
                rows.push({ rank, team, gp: t(3), w: t(4), tie: t(5), l: t(6), gfga: t(7), gd: t(8), tp: t(9) });
            }
        } catch (e) { console.error('parseStandings', e); }
        return rows;
    }

    static parseStats(html) {
        const rows = [];
        try {
            const dec = decodeHTML(html);
            const parts = dec.split('<tr');
            for (let i = 1; i < parts.length; i++) {
                const row = parts[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
                const cells = row.split('<td');
                if (cells.length < 10) continue;
                const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                const name = t(3), team = t(4);
                if (!name || name === 'Player' || name === 'Name') continue;
                rows.push({ rank: t(1), name, team, gp: t(6), g: t(7), a: t(8), tp: t(9) });
            }
        } catch (e) { console.error('parseStats', e); }
        return rows;
    }

    static parseGoalieStats(html) {
        const rows = [];
        try {
            const dec = decodeHTML(html);
            const parts = dec.split('<tr');
            for (let i = 1; i < parts.length; i++) {
                const row = parts[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
                const cells = row.split('<td');
                if (cells.length < 14) continue;
                const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                const name = t(3), team = t(4);
                if (!name || name === 'Player' || name === 'Name') continue;
                rows.push({ rank: t(1), name, team, gp: t(6), sog: t(9), ga: t(10), gaa: t(11), svs: t(12), svsp: t(13) });
            }
        } catch (e) { console.error('parseGoalieStats', e); }
        return rows;
    }

    static parseEvents(html) {
        const d = { periods: [], venue: '', spectators: '', shots: null, periodScores: '', totalScore: '' };
        try {
            const dec = decodeHTML(html);
            const vm = dec.match(/<b>([^<]+)<\/h3>/);
            if (vm) d.venue = vm[1].trim();
            const sm = dec.match(/Spectators:\s*(\d[\d,]*)/);
            if (sm) d.spectators = sm[1];
            const tsm = dec.match(/(\d+\s*-\s*\d+)[\s\S]{0,30}\(([\d\s\-,]+)\)\s*<\/div>/);
            if (tsm) { d.totalScore = tsm[1].replace(/\s/g, ''); d.periodScores = tsm[2].trim(); }
            const shotRows = [...dec.matchAll(/>Shots<\/td>[\s\S]*?<strong>(\d+)<\/strong>[\s\S]*?\(([^)]+)\)/g)];
            if (shotRows.length >= 2) d.shots = { home: { total: shotRows[0][1], periods: shotRows[0][2] }, away: { total: shotRows[1][1], periods: shotRows[1][2] } };
            const blocks = dec.split(/<h3>(\d+.. period|Overtime|Game Winning Shot)<\/h3>/i);
            for (let i = 1; i < blocks.length; i += 2) {
                const title = blocks[i];
                const content = blocks[i + 1].split('</table>')[0];
                const events = [];
                content.split('<tr').forEach(row => {
                    const cells = row.split('<td');
                    if (cells.length < 4) return;
                    const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                    const time = t(1);
                    const isGoal = row.includes('font-weight:bold') && row.match(/\d+\s*[-–]\s*\d+/);
                    if (isGoal && cells.length >= 5) {
                        const score = t(2);
                        let raw4 = cells[4]?.substring(cells[4].indexOf('>') + 1) || '';
                        let desc = raw4.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                        const assists = [];
                        for (const m of raw4.matchAll(/title=["'][^"']*Assists[^"']*["']>([^<]+)/g)) {
                            const n = m[1].trim(); if (n && !assists.includes(n)) assists.push(n);
                        }
                        if (assists.length) desc += ` (${assists.join(', ')})`;
                        events.push({ type: 'goal', time, score, desc });
                    } else {
                        const dur = t(2);
                        if (dur.includes('min')) {
                            events.push({ type: 'penalty', time, duration: dur, team: t(3), desc: cells[4]?.substring(cells[4].indexOf('>') + 1).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '' });
                        }
                    }
                });
                if (events.length) d.periods.push({ title, events });
            }
        } catch (e) { console.error('parseEvents', e); }
        return d;
    }

    static parseLineups(html) {
        const info = { referees: [], linesmen: [], teams: [] };
        try {
            const dec = decodeHTML(html);
            const refM = dec.match(/<strong>Referee\(s\)<\/strong><\/td>[^>]*>([^<]+)<\/td>/);
            if (refM) info.referees = refM[1].split(',').map(s => s.trim());
            const linM = dec.match(/<strong>Linesmen<\/strong><\/td>[^>]*>([^<]+)<\/td>/);
            if (linM) info.linesmen = linM[1].split(',').map(s => s.trim());
            dec.split(/class="tdSubTitle"[^>]*><h3>/i).slice(1).forEach(block => {
                const teamName = block.split('</h3>')[0].trim();
                const lineup = { name: teamName, coach: '', roster: [] };
                const cm = block.match(/<strong>Head Coach:\s*<\/strong>\s*([^<]+)<\/td>/i);
                if (cm) lineup.coach = cm[1].replace(/&nbsp;/g, '').trim();
                const lines = block.split(/<th[^>]*><strong>(Goalies|1st Line|2nd Line|3rd Line|4th Line|Extra Players)<\/strong><\/th>/i);
                for (let i = 1; i < lines.length; i += 2) {
                    const lname = lines[i];
                    const content = lines[i + 1].split('</table>')[0];
                    [...content.matchAll(/<div class="lineUpPlayer[^>]*>(\d+)\.\s*([^<]+)<\/div>/g)].forEach(m => {
                        lineup.roster.push({ num: m[1], name: m[2].trim(), line: lname });
                    });
                }
                info.teams.push(lineup);
            });
        } catch (e) { console.error('parseLineups', e); }
        return info;
    }

    static buildFormMap(games) {
        const map = {};
        games.filter(g => g.status === 'Final').forEach(g => {
            const h = parseInt(g.home.score) || 0, a = parseInt(g.away.score) || 0;
            let hr = h > a ? 'w' : a > h ? 'l' : 'd';
            let ar = a > h ? 'w' : h > a ? 'l' : 'd';
            [g.home.name, g.away.name].forEach((team, idx) => {
                if (!map[team]) map[team] = [];
                map[team].push(idx === 0 ? hr : ar);
            });
        });
        Object.keys(map).forEach(k => { map[k] = map[k].slice(-5); });
        return map;
    }

    static extractH2H(homeTeam, awayTeam, games) {
        return games.filter(g =>
            (g.home.name === homeTeam && g.away.name === awayTeam) ||
            (g.home.name === awayTeam && g.away.name === homeTeam)
        ).slice(-10);
    }

    static _proc(home, away, raw, id) {
        raw = raw.trim();
        let homeScore = '–', awayScore = '–', status = 'Upcoming', time = raw;
        const sm = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (sm) {
            homeScore = sm[1]; awayScore = sm[2];
            const lo = raw.toLowerCase();
            if (isLiveStatus(lo)) {
                const pm = raw.match(/(Period \d+|Overtime|GWS|OT|Str)/i);
                status = pm ? pm[0] : 'LIVE'; time = 'LIVE';
            } else { status = 'Final'; time = 'FT'; }
        } else {
            const tm = raw.match(/\d{2}:\d{2}/);
            time = tm ? tm[0] : (raw || 'TBD');
        }
        return { id: id || Math.random().toString(36).slice(2), realId: id, time, status, home: { name: home, score: homeScore }, away: { name: away, score: awayScore } };
    }
}

// ── Live Clock ─────────────────────────────────────────────────
function startLiveClocks(games) {
    clearInterval(clockInterval);
    clockInterval = null;
    const live = games.filter(g => isLiveStatus(g.status));
    if (!live.length) return;

    // Initialize clocks for newly live games
    live.forEach(g => {
        if (!liveClockMap[g.id]) {
            liveClockMap[g.id] = { startTs: Date.now(), period: g.status };
        }
    });
    // Remove stale
    const liveIds = new Set(live.map(g => g.id));
    Object.keys(liveClockMap).forEach(k => { if (!liveIds.has(k)) delete liveClockMap[k]; });

    clockInterval = setInterval(() => {
        Object.entries(liveClockMap).forEach(([id, clk]) => {
            const el = document.querySelector(`[data-game-id="${id}"] .gr-clock`);
            if (!el) return;
            const elapsed = Math.floor((Date.now() - clk.startTs) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            el.textContent = `${m}:${s}`;
        });
    }, 1000);
}

// ── Score animation ────────────────────────────────────────────
function detectScoreChanges(games) {
    games.forEach(g => {
        const prev = prevScores[g.id];
        if (prev && (prev.home !== g.home.score || prev.away !== g.away.score)) {
            const row = document.querySelector(`[data-game-id="${g.id}"]`);
            if (row) {
                row.classList.add('score-flash');
                setTimeout(() => row.classList.remove('score-flash'), 2500);
            }
            // Notification
            if (watchedGames.has(g.realId) && Notification.permission === 'granted') {
                new Notification('🏒 Goal!', { body: `${g.home.name} ${g.home.score} – ${g.away.score} ${g.away.name}` });
            }
        }
        prevScores[g.id] = { home: g.home.score, away: g.away.score };
    });
}

// ── Fetch ──────────────────────────────────────────────────────
async function fetchData() {
    clearTimeout(pollTimer);
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    setLoadingState(true);

    const lid = UI.leagueSelect.value;
    const lname = getLeagueName(lid);
    if (UI.bcLeague) UI.bcLeague.textContent = lname;
    if (UI.bcStatsLeague) UI.bcStatsLeague.textContent = lname;
    buildSidebar();

    let url = '';
    const todayFlag = isToday(currentDate);
    if (currentSection === 'games') url = todayFlag ? CONFIG.LIVE_URL + lid : CONFIG.SCHEDULE_URL + lid;
    if (currentSection === 'standings') url = CONFIG.STANDINGS_URL + lid;
    if (currentSection === 'stats') url = (currentStatsTab === 'scorers' ? CONFIG.STATS_URL : CONFIG.GOALIE_STATS_URL) + lid;

    try {
        const res = await fetch(proxy(url), { signal: fetchController.signal });
        if (!res.ok) throw new Error(res.status);
        const html = await res.text();

        if (currentSection === 'games') {
            let games = todayFlag ? Parser.parseLive(html) : Parser.parseSchedule(html);
            if (!todayFlag) {
                allScheduleGames = games; // Cache full schedule
                const ymd = dateToYMD(currentDate);
                games = games.filter(g => g.date === ymd);
            }
            detectScoreChanges(games);
            startLiveClocks(games);
            const liveCount = games.filter(g => isLiveStatus(g.status)).length;
            updateLiveBadge(liveCount);
            renderGames(games);
        } else if (currentSection === 'standings') {
            const rows = Parser.parseStandings(html);
            // Kick-off form fetch in background
            fetchFormData(lid).then(formMap => renderStandings(rows, formMap));
            renderStandings(rows, {});
            return;
        } else if (currentSection === 'stats') {
            currentStatsTab === 'scorers' ? renderStats(Parser.parseStats(html)) : renderGoalieStats(Parser.parseGoalieStats(html));
        }

        setLoadingState(false, true);
        UI.errorContainer.classList.add('hidden');
        const now = new Date();
        UI.lastUpdatedTime.textContent = `Updated ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('fetchData', err);
        setLoadingState(false, false);
        UI.errorContainer.classList.remove('hidden');
    } finally {
        fetchController = null;
    }
    if (currentSection === 'games') pollTimer = setTimeout(fetchData, CONFIG.POLL_INTERVAL);
}

async function fetchFormData(lid) {
    try {
        const res = await fetch(proxy(CONFIG.SCHEDULE_URL + lid));
        if (!res.ok) return {};
        const html = await res.text();
        allScheduleGames = Parser.parseSchedule(html);
        return Parser.buildFormMap(allScheduleGames);
    } catch { return {}; }
}

async function fetchMatchDetails(game) {
    modalGame = game;
    UI.modal.classList.remove('hidden');
    UI.modalMatchHeader.innerHTML = `<div class="mh-teams"><span>${game.home.name}</span><span class="mh-score">${game.home.score} – ${game.away.score}</span><span>${game.away.name}</span></div>`;
    UI.modalBody.innerHTML = '<div class="empty-state">Loading…</div>';
    switchModalSection('summary');
    try {
        const [evRes, luRes] = await Promise.all([
            fetch(proxy(CONFIG.EVENTS_URL + game.realId)),
            fetch(proxy(CONFIG.LINEUPS_URL + game.realId))
        ]);
        const details = Parser.parseEvents(await evRes.text());
        const lineups = Parser.parseLineups(await luRes.text());
        details.matchInfo = lineups;
        renderDetails(details, game);
    } catch {
        UI.modalBody.innerHTML = '<div class="empty-state" style="color:var(--red)">Failed to load.</div>';
    }
}

// ── Filter helpers ─────────────────────────────────────────────
function applyStatusFilter(games) {
    switch (currentFilter) {
        case 'live': return games.filter(g => isLiveStatus(g.status));
        case 'scheduled': return games.filter(g => g.status === 'Upcoming');
        case 'finished': return games.filter(g => g.status === 'Final');
        case 'favorites': return games.filter(g => favorites.has(g.home.name) || favorites.has(g.away.name));
        default: return games;
    }
}

function applySearch(items) {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => {
        if (item.home) return item.home.name.toLowerCase().includes(q) || item.away.name.toLowerCase().includes(q);
        if (item.name) return item.name.toLowerCase().includes(q) || (item.team || '').toLowerCase().includes(q);
        if (item.team) return item.team.toLowerCase().includes(q);
        return false;
    });
}

function updateLiveBadge(count) {
    UI.liveBadge.textContent = count;
    UI.liveBadge.classList.toggle('hidden', count === 0);
    // Also update nav games badge
    let navBadge = $('nav-games-badge');
    if (!navBadge) {
        navBadge = document.createElement('span');
        navBadge.id = 'nav-games-badge';
        navBadge.className = 'nav-badge';
        $('nav-games').appendChild(navBadge);
    }
    navBadge.textContent = count;
    navBadge.style.display = count > 0 ? 'flex' : 'none';
}

// ── Render: Games ──────────────────────────────────────────────
function renderGames(games) {
    const filtered = applySearch(applyStatusFilter(games));
    UI.gamesContainer.innerHTML = '';

    if (!filtered.length) {
        UI.gamesContainer.innerHTML = `<div class="empty-state">${currentFilter === 'favorites' ? 'No favorites. Tap ☆ next to a team!' : 'No games found.'}</div>`;
        return;
    }

    // League header
    const banner = document.createElement('div');
    banner.className = 'league-banner';
    banner.innerHTML = `<span class="lb-flag">🇸🇪</span><span class="lb-country">Sweden</span><span class="lb-name">${getLeagueName(UI.leagueSelect.value)}</span><span class="lb-count">${filtered.length} game${filtered.length !== 1 ? 's' : ''}</span>`;
    UI.gamesContainer.appendChild(banner);

    filtered.forEach(g => {
        const clone = UI.gameRowTpl.content.cloneNode(true);
        const row = clone.querySelector('.game-row');
        row.dataset.gameId = g.id;

        const lo = g.status.toLowerCase();
        const isLive = isLiveStatus(g.status);
        const isFinal = g.status === 'Final';

        if (isLive) row.classList.add('is-live');
        else if (isFinal) row.classList.add('is-final');
        else row.classList.add('is-scheduled');

        // Status column
        const periodEl = row.querySelector('.gr-period');
        const clockEl = row.querySelector('.gr-clock');
        const dotEl = row.querySelector('.live-dot');

        if (isLive) {
            // Extract period abbreviation
            const pm = g.status.match(/(Period \d+|Overtime|OT|GWS)/i);
            const pLabel = pm ? pm[0].replace('Period ', '').replace('1', '1st').replace('2', '2nd').replace('3', '3rd') : 'LIVE';
            periodEl.textContent = pLabel;
            clockEl.textContent = '00:00';
            dotEl.classList.remove('hidden');
        } else if (isFinal) {
            periodEl.textContent = 'FT';
            clockEl.textContent = '';
        } else {
            periodEl.textContent = '';
            clockEl.textContent = g.time;
        }

        // Teams
        const [homeRow, awayRow] = row.querySelectorAll('.gr-team');
        homeRow.querySelector('.gr-name').textContent = g.home.name;
        awayRow.querySelector('.gr-name').textContent = g.away.name;

        const hScore = row.querySelectorAll('.gr-score')[0];
        const aScore = row.querySelectorAll('.gr-score')[1];
        hScore.textContent = g.home.score;
        aScore.textContent = g.away.score;

        if (isFinal) {
            const h = parseInt(g.home.score) || 0, a = parseInt(g.away.score) || 0;
            if (h > a) { homeRow.classList.add('winner'); hScore.classList.add('winner-score'); }
            else if (a > h) { awayRow.classList.add('winner'); aScore.classList.add('winner-score'); }
        }

        // Fav stars
        const [hStar, aStar] = row.querySelectorAll('.fav-star');
        updateStar(hStar, g.home.name);
        updateStar(aStar, g.away.name);
        hStar.addEventListener('click', e => { e.stopPropagation(); toggleFav(g.home.name, hStar); });
        aStar.addEventListener('click', e => { e.stopPropagation(); toggleFav(g.away.name, aStar); });

        // Info button + row click
        const infoBtn = row.querySelector('.gr-info-btn');
        if (g.realId) {
            infoBtn.addEventListener('click', e => { e.stopPropagation(); fetchMatchDetails(g); });
            row.addEventListener('click', () => fetchMatchDetails(g));
            // Watch bell for live games
            if (isLive) {
                const wb = document.createElement('button');
                wb.className = `watch-btn${watchedGames.has(g.realId) ? ' watching' : ''}`;
                wb.title = watchedGames.has(g.realId) ? 'Stop alerts' : 'Alert on goal';
                wb.textContent = '🔔';
                wb.addEventListener('click', e => {
                    e.stopPropagation();
                    watchedGames.has(g.realId) ? watchedGames.delete(g.realId) : watchedGames.add(g.realId);
                    wb.classList.toggle('watching');
                });
                row.querySelector('.gr-actions').prepend(wb);
            }
        } else {
            infoBtn.style.display = 'none';
        }

        UI.gamesContainer.appendChild(clone);
    });
}

function updateStar(btn, name) {
    const isFav = favorites.has(name);
    btn.textContent = isFav ? '⭐' : '☆';
    btn.classList.toggle('is-fav', isFav);
}

function toggleFav(name, star) {
    favorites.has(name) ? favorites.delete(name) : favorites.add(name);
    saveFavs();
    updateStar(star, name);
    if (currentFilter === 'favorites') fetchData();
}

// ── Render: Standings ──────────────────────────────────────────
function renderStandings(rows, formMap = {}) {
    const filtered = applySearch(rows);
    const sorted = sortStandings(filtered);
    UI.standingsBody.innerHTML = '';
    if (!sorted.length) { UI.standingsBody.innerHTML = '<tr><td colspan="10" class="empty-state">No data.</td></tr>'; return; }

    const total = sorted.length;
    // Zone thresholds (generic: top 2 = promotion, bottom 2 = relegation)
    const proZone = 2, relZone = total - 2;

    sorted.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (idx < proZone) tr.classList.add('zone-pro');
        else if (idx >= relZone) tr.classList.add('zone-rel');
        tr.addEventListener('click', () => showTeamStats(r.team));

        const formArr = formMap[r.team] || [];
        const forms = formArr.length
            ? formArr.map(f => `<span class="form-dot form-${f}">${f.toUpperCase()}</span>`).join('')
            : '–';

        const isFav = favorites.has(r.team);
        tr.innerHTML = `
            <td class="col-rank">${r.rank}</td>
            <td class="text-left td-team"><strong>${r.team}</strong></td>
            <td>${r.gp}</td><td>${r.w}</td><td>${r.tie}</td><td>${r.l}</td>
            <td class="col-gd">${r.gd}</td>
            <td class="tp-cell">${r.tp}</td>
            <td><div class="form-cell">${forms}</div></td>
            <td><button class="fav-star standings-star" data-team="${r.team}">${isFav ? '⭐' : '☆'}</button></td>`;
        UI.standingsBody.appendChild(tr);
    });

    // Wire standing star buttons
    UI.standingsBody.querySelectorAll('.standings-star').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const t = btn.dataset.team;
            favorites.has(t) ? favorites.delete(t) : favorites.add(t);
            saveFavs();
            btn.textContent = favorites.has(t) ? '⭐' : '☆';
        });
    });

    setLoadingState(false, true);
    UI.errorContainer.classList.add('hidden');
    const now = new Date();
    UI.lastUpdatedTime.textContent = `Updated ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function sortStandings(rows) {
    return [...rows].sort((a, b) => {
        const col = standingsSort.col;
        let va = col === 'team' ? a[col] : (parseFloat(a[col]) || 0);
        let vb = col === 'team' ? b[col] : (parseFloat(b[col]) || 0);
        if (col === 'team') {
            return standingsSort.asc ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        // GD can be negative
        if (col === 'gd') { va = parseFloat(String(a.gd).replace('+', '')) || 0; vb = parseFloat(String(b.gd).replace('+', '')) || 0; }
        return standingsSort.asc ? va - vb : vb - va;
    });
}

async function showTeamStats(teamName) {
    currentSection = 'stats'; currentStatsTab = 'scorers';
    switchSection('stats');
    await fetchData();
    setTimeout(() => {
        document.querySelectorAll('#stats-body tr').forEach(row => {
            if (row.textContent.includes(teamName)) {
                row.style.background = 'var(--accent-dim)';
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }, 100);
}

// ── Render: Stats ──────────────────────────────────────────────
function renderStats(rows) {
    UI.statsHeader.innerHTML = `<th class="col-rank">#</th><th class="text-left">Player</th><th class="text-left">Team</th><th>GP</th><th>G</th><th>A</th><th><strong>PTS</strong></th>`;
    const filtered = applySearch(rows);
    UI.statsBody.innerHTML = '';
    if (!filtered.length) { UI.statsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No data.</td></tr>'; return; }
    filtered.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="col-rank">${r.rank}</td><td class="text-left"><strong>${r.name}</strong></td><td class="text-left td-team-small">${r.team}</td><td>${r.gp}</td><td>${r.g}</td><td>${r.a}</td><td class="tp-cell">${r.tp}</td>`;
        UI.statsBody.appendChild(tr);
    });
}

function renderGoalieStats(rows) {
    UI.statsHeader.innerHTML = `<th class="col-rank">#</th><th class="text-left">Goalie</th><th class="text-left">Team</th><th>GP</th><th>SOG</th><th>GA</th><th>GAA</th><th class="tp-cell">SVS%</th>`;
    const filtered = applySearch(rows);
    UI.statsBody.innerHTML = '';
    if (!filtered.length) { UI.statsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No data.</td></tr>'; return; }
    filtered.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="col-rank">${r.rank}</td><td class="text-left"><strong>${r.name}</strong></td><td class="text-left td-team-small">${r.team}</td><td>${r.gp}</td><td>${r.sog}</td><td>${r.ga}</td><td>${r.gaa}</td><td class="tp-cell">${r.svsp}</td>`;
        UI.statsBody.appendChild(tr);
    });
}

// ── Render: Modal ──────────────────────────────────────────────
function renderDetails(d, game) {
    // Update header with full info
    UI.modalMatchHeader.innerHTML = `
        <div class="mh-venue">${d.venue || 'Unknown Venue'}</div>
        <div class="mh-score-row">
            <span class="mh-team">${game.home.name}</span>
            <span class="mh-score">${d.totalScore || '–'}</span>
            <span class="mh-team">${game.away.name}</span>
        </div>
        <div class="mh-sub">${d.periodScores ? `(${d.periodScores})` : ''} ${d.spectators ? `· 👥 ${parseInt(d.spectators).toLocaleString()}` : ''}</div>`;

    let html = '';
    if (d.shots) {
        const hS = parseInt(d.shots.home.total) || 0, aS = parseInt(d.shots.away.total) || 0;
        const pct = Math.round(hS / (hS + aS || 1) * 100);
        html += `<div class="shots-box"><div class="shots-label">Shots on Goal</div>
            <div class="shots-row"><span class="shots-num home">${hS}</span>
            <div class="shots-track"><div class="shots-fill" style="width:${pct}%"></div></div>
            <span class="shots-num away">${aS}</span></div>
            <div class="shots-periods">${d.shots.home.periods} | ${d.shots.away.periods}</div></div>`;
    }
    if (!d.periods.length) html += '<div class="empty-state">No events recorded.</div>';
    [...d.periods].reverse().forEach(p => {
        html += `<div class="period-block"><div class="period-title">${p.title}</div>`;
        html += p.events.map(e => e.type === 'goal'
            ? `<div class="ev-row goal"><span class="ev-time">${e.time}</span><span class="ev-chip goal-chip">${e.score}</span><span class="ev-desc">${e.desc}</span></div>`
            : `<div class="ev-row penalty"><span class="ev-time">${e.time}</span><span class="ev-chip pen-chip">${e.duration}</span><span class="ev-desc">${e.team ? `[${e.team}] ` : ''}${e.desc}</span></div>`
        ).join('');
        html += '</div>';
    });
    if (d.matchInfo?.referees?.length) {
        html += `<div class="match-info-section"><div class="period-title">Officials</div><div class="info-grid">
            <div class="info-row"><span class="info-lbl">Referees</span><span>${d.matchInfo.referees.join(', ')}</span></div>
            ${d.matchInfo.linesmen?.length ? `<div class="info-row"><span class="info-lbl">Linesmen</span><span>${d.matchInfo.linesmen.join(', ')}</span></div>` : ''}
        </div></div>`;
    }
    UI.modalBody.innerHTML = html;
    renderLineups(d.matchInfo);
    renderH2H(game);
}

function renderLineups(info) {
    if (!info?.teams?.length) { UI.modalLineups.innerHTML = '<div class="empty-state">Lineups not available yet.</div>'; return; }
    let html = '';
    info.teams.forEach(team => {
        html += `<div class="lineup-team"><div class="lineup-team-hdr">${team.name} <span class="coach-lbl">(${team.coach || 'N/A'})</span></div><div class="lineup-grid">`;
        ['Goalies', '1st Line', '2nd Line', '3rd Line', '4th Line', 'Extra Players'].forEach(line => {
            const players = team.roster.filter(p => p.line === line);
            if (players.length) {
                html += `<div class="lineup-row"><div class="line-lbl">${line}</div><div class="players-list">${players.map(p => `<span class="player-chip"><i>${p.num}</i> ${p.name}</span>`).join('')}</div></div>`;
            }
        });
        html += '</div></div>';
    });
    UI.modalLineups.innerHTML = html;
}

function renderH2H(game) {
    const h2h = Parser.extractH2H(game.home.name, game.away.name, allScheduleGames);
    if (!h2h.length) { UI.modalH2h.innerHTML = '<div class="empty-state">No H2H data — load Past Results first.</div>'; return; }
    let html = `<div class="h2h-hdr"><span>${game.home.name}</span><span class="h2h-vs">H2H</span><span>${game.away.name}</span></div><div class="h2h-list">`;
    [...h2h].reverse().forEach(g => {
        const h = parseInt(g.home.score) || 0, a = parseInt(g.away.score) || 0;
        const who = h > a ? 'home' : a > h ? 'away' : 'draw';
        html += `<div class="h2h-row"><span class="h2h-team ${who === 'home' ? 'h2h-win' : ''}">${g.home.name}</span><span class="h2h-score">${g.home.score} – ${g.away.score}</span><span class="h2h-team ${who === 'away' ? 'h2h-win' : ''} text-right">${g.away.name}</span></div>`;
    });
    UI.modalH2h.innerHTML = html + '</div>';
}

function switchModalSection(sec) {
    UI.modalBody.classList.toggle('hidden', sec !== 'summary');
    UI.modalLineups.classList.toggle('hidden', sec !== 'lineups');
    UI.modalH2h.classList.toggle('hidden', sec !== 'h2h');
    document.querySelectorAll('.modal-tab').forEach(b => b.classList.toggle('active', b.dataset.modalSection === sec));
}

// ── Loading state ──────────────────────────────────────────────
function setLoadingState(on, success = false) {
    UI.statusText.textContent = on ? 'Loading…' : success ? 'Live' : 'Error';
    UI.statusPill.className = `status-chip${success ? ' connected' : on ? '' : ' error'}`;
    UI.refreshBtn.classList.toggle('spinning', on);
    if (success && currentSection === 'games') UI.statusPill.classList.add('live-pulse');
    else UI.statusPill.classList.remove('live-pulse');

    if (!on) return;
    if (currentSection === 'games') {
        UI.gamesContainer.innerHTML = '';
        for (let i = 0; i < 6; i++) UI.gamesContainer.appendChild(UI.skelGameTpl.content.cloneNode(true));
    } else if (currentSection === 'standings') {
        UI.standingsBody.innerHTML = '';
        for (let i = 0; i < 14; i++) UI.standingsBody.appendChild(UI.skelTableTpl.content.cloneNode(true));
    } else {
        UI.statsBody.innerHTML = '';
        for (let i = 0; i < 10; i++) UI.statsBody.appendChild(UI.skelTableTpl.content.cloneNode(true));
    }
}

// ── Section switching ──────────────────────────────────────────
function switchSection(section) {
    currentSection = section;
    [UI.sectionGames, UI.sectionStandings, UI.sectionStats].forEach(el => el.classList.remove('active-section'));
    const map = { games: UI.sectionGames, standings: UI.sectionStandings, stats: UI.sectionStats };
    map[section].classList.add('active-section');
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.section === section));
    document.querySelectorAll('.mbn-btn[data-section]').forEach(b => b.classList.toggle('active', b.dataset.section === section));
    if (section !== 'games') clearInterval(clockInterval);
}

// ── Theme ──────────────────────────────────────────────────────
function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fs-theme', theme);
    UI.themeMoon.classList.toggle('hidden', theme === 'light');
    UI.themeSun.classList.toggle('hidden', theme === 'dark');
}

UI.themeBtn.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));
$('mobile-theme-btn').addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'));

// ── Search ─────────────────────────────────────────────────────
let searchOpen = false;
UI.searchToggle.addEventListener('click', () => {
    searchOpen = !searchOpen;
    UI.searchWrap.classList.toggle('search-open', searchOpen);
    if (searchOpen) UI.searchInput.focus();
    else { UI.searchInput.value = ''; searchQuery = ''; UI.searchClear.classList.add('hidden'); fetchData(); }
});
UI.searchInput.addEventListener('input', () => {
    UI.searchClear.classList.toggle('hidden', !UI.searchInput.value);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { searchQuery = UI.searchInput.value.trim(); fetchData(); }, 250);
});
UI.searchClear.addEventListener('click', () => {
    UI.searchInput.value = ''; searchQuery = ''; UI.searchClear.classList.add('hidden');
    UI.searchInput.focus(); fetchData();
});

// ── Notifications ──────────────────────────────────────────────
UI.notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) return alert('Not supported.');
    const p = await Notification.requestPermission();
    if (p === 'granted') { UI.notifyBtn.classList.add('notify-on'); new Notification('🏒 SweHockey Live', { body: 'Goal alerts enabled!' }); }
});

// ── Calendar ───────────────────────────────────────────────────
UI.calendarBtn.addEventListener('click', () => {
    UI.calendarInput.valueAsDate = currentDate;
    UI.calendarInput.style.position = 'fixed';
    UI.calendarInput.style.opacity = '0';
    UI.calendarInput.style.pointerEvents = 'all';
    UI.calendarInput.style.width = '1px';
    UI.calendarInput.style.height = '1px';
    UI.calendarInput.showPicker?.();
    UI.calendarInput.click();
});
UI.calendarInput.addEventListener('change', () => {
    const [y, m, d] = UI.calendarInput.value.split('-').map(Number);
    currentDate = new Date(y, m - 1, d);
    UI.calendarInput.style.pointerEvents = 'none';
    buildDateStrip();
    fetchData();
});

// ── Standings sort ─────────────────────────────────────────────
document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.col;
        document.querySelectorAll('.sortable').forEach(h => {
            h.classList.toggle('active-sort', h.dataset.col === col);
            h.classList.toggle('asc', h.dataset.col === col && standingsSort.asc);
        });
        fetchData();
    });
});

// ── Status filter bar ──────────────────────────────────────────
document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.toggle('active', b === btn));
        if (currentSection === 'games') fetchData();
    });
});

// ── Stats sub-tabs ─────────────────────────────────────────────
UI.statsScorersBtn.addEventListener('click', () => { currentStatsTab = 'scorers'; UI.statsScorersBtn.classList.add('active'); UI.statsGoaliesBtn.classList.remove('active'); fetchData(); });
UI.statsGoaliesBtn.addEventListener('click', () => { currentStatsTab = 'goalies'; UI.statsGoaliesBtn.classList.add('active'); UI.statsScorersBtn.classList.remove('active'); fetchData(); });

// ── Main nav ───────────────────────────────────────────────────
document.querySelectorAll('.nav-tab[data-section]').forEach(btn => btn.addEventListener('click', () => { switchSection(btn.dataset.section); fetchData(); }));
document.querySelectorAll('.mbn-btn[data-section]').forEach(btn => btn.addEventListener('click', () => { switchSection(btn.dataset.section); fetchData(); }));

// ── Modal ──────────────────────────────────────────────────────
const closeModalFn = () => { UI.modal.classList.add('hidden'); switchModalSection('summary'); };
$('close-modal') && $('close-modal').addEventListener('click', closeModalFn);
UI.modalBackdrop.addEventListener('click', closeModalFn);
document.querySelectorAll('.modal-tab').forEach(btn => btn.addEventListener('click', () => switchModalSection(btn.dataset.modalSection)));

// ── League change ──────────────────────────────────────────────
UI.leagueSelect.addEventListener('change', () => { buildSidebar(); fetchData(); });
UI.refreshBtn.addEventListener('click', fetchData);
UI.retryBtn.addEventListener('click', fetchData);

// ── Scroll to top ──────────────────────────────────────────────
window.addEventListener('scroll', () => {
    UI.scrollTopBtn.classList.toggle('hidden', window.scrollY < 300);
}, { passive: true });
UI.scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ── Init ───────────────────────────────────────────────────────
applyTheme(currentTheme);
buildDateStrip();
buildSidebar();
fetchData();
