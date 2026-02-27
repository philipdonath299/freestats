/* ================================================
   app.js — Swehockey Live Tracker (Flashscore Edition)
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

// ── UI references ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

const UI = {
    leagueSelect: $('league-select'),
    refreshBtn: $('refresh-btn'),
    statusText: $('status-text'),
    statusPill: $('status-pill'),
    lastUpdatedTime: $('last-updated-time'),

    // Sections
    sectionGames: $('section-games'),
    sectionStandings: $('section-standings'),
    sectionStats: $('section-stats'),

    // Games
    gamesContainer: $('games-container'),
    liveBtn: $('live-view-btn'),
    scheduleBtn: $('schedule-view-btn'),
    favoritesFilterBtn: $('favorites-filter-btn'),
    gameTemplate: $('game-row-template'),

    // Date navigator
    dateNav: $('date-nav'),
    datePrevBtn: $('date-prev-btn'),
    dateNextBtn: $('date-next-btn'),
    dateTodayBtn: $('date-today-btn'),
    dateDisplay: $('date-display'),

    // Standings
    standingsBody: $('standings-body'),

    // Stats
    statsBody: $('stats-body'),
    statsHeader: $('stats-header'),
    statsScorersBtn: $('stats-scorers-btn'),
    statsGoaliesBtn: $('stats-goalies-btn'),

    // Error
    errorContainer: $('error-container'),
    retryBtn: $('retry-btn'),

    // Loading Templates
    skeletonGameTemplate: $('skeleton-game-template'),
    skeletonTableTemplate: $('skeleton-table-template'),

    // Modal
    modal: $('game-modal'),
    modalBody: $('modal-body'),
    modalLineups: $('modal-lineups'),
    modalH2h: $('modal-h2h'),
    closeModal: $('close-modal'),
    backdrop: $('modal-backdrop'),

    // Search
    searchWrap: $('search-wrap'),
    searchToggleBtn: $('search-toggle-btn'),
    searchInput: $('search-input'),
    searchClearBtn: $('search-clear-btn'),

    // Theme
    themeBtn: $('theme-btn'),
    themeIconDark: $('theme-icon-dark'),
    themeIconLight: $('theme-icon-light'),

    // Notify
    notifyBtn: $('notify-btn'),

    // Scroll to top
    scrollTopBtn: $('scroll-top-btn'),
};

// ── State ────────────────────────────────────────────────────────
let currentSection = 'games';
let currentView = 'live';
let currentStatsTab = 'scorers';
let pollTimer = null;
let fetchController = null;
let searchQuery = '';
let searchDebounce = null;
let favoritesOnly = false;
let currentDate = new Date();
currentDate.setHours(0, 0, 0, 0);
let currentTheme = localStorage.getItem('theme') || 'dark';
let favorites = new Set(JSON.parse(localStorage.getItem('favorites') || '[]'));
let watchedGames = new Set();
let lastGameSnapshot = {};
// Store current modal target game for H2H
let modalGame = null;
let allScheduleGames = []; // cached schedule for form/H2H

// ── Helpers ──────────────────────────────────────────────────────
const decodeHTML = html => {
    const t = document.createElement('textarea');
    t.innerHTML = html;
    return t.value;
};

const proxy = url => CONFIG.CORS_PROXY + encodeURIComponent(url);

const saveFavorites = () => localStorage.setItem('favorites', JSON.stringify([...favorites]));

const isSameDay = (a, b) => a.toDateString() === b.toDateString();

const today = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
};

function formatDateDisplay(date) {
    const t = today();
    const yesterday = new Date(t); yesterday.setDate(t.getDate() - 1);
    const tomorrow = new Date(t); tomorrow.setDate(t.getDate() + 1);
    if (isSameDay(date, t)) return 'Today';
    if (isSameDay(date, yesterday)) return 'Yesterday';
    if (isSameDay(date, tomorrow)) return 'Tomorrow';
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Build YYYY-MM-DD string for URL usage
function dateToParam(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ── Parser ───────────────────────────────────────────────────────
class Parser {

    static parseLive(html) {
        const games = [];
        try {
            const decoded = decodeHTML(html);
            const blocks = decoded.split('TodaysGamesGame');
            const seen = new Set();
            for (let i = 1; i < blocks.length; i++) {
                const b = blocks[i];
                const teams = [...b.matchAll(/class="h2[^>]*>([^<]+)/g)];
                if (teams.length < 2) continue;
                const home = teams[0][1].trim();
                const away = teams[1][1].trim();
                let raw = 'Scheduled';
                const rm = b.match(/class=[^>]*Result[^>]*>([\s\S]*?)<\/div>/);
                if (rm) raw = rm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                let id = null;
                const im = b.match(/\/Game\/(?:Events|GamePreview)\/(\d+)/i);
                if (im) id = im[1];
                const key = `${home}|${away}|${id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                games.push(Parser._processGame(home, away, raw, id));
            }
        } catch (e) { console.error('parseLive', e); }
        return games;
    }

    static parseSchedule(html) {
        const games = [];
        try {
            const decoded = decodeHTML(html);
            const rows = decoded.split('<tr');
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
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
                if (home && away) games.push(Parser._processGame(home, away, raw, id));
            }
        } catch (e) { console.error('parseSchedule', e); }
        return games;
    }

    static parseStandings(html) {
        const rows = [];
        try {
            const decoded = decodeHTML(html);
            const parts = decoded.split('<tr');
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
            const decoded = decodeHTML(html);
            const parts = decoded.split('<tr');
            for (let i = 1; i < parts.length; i++) {
                const row = parts[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
                const cells = row.split('<td');
                if (cells.length < 10) continue;
                const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                const rank = t(1), name = t(3), team = t(4);
                if (!name || name === 'Player' || name === 'Name') continue;
                rows.push({ rank, name, team, gp: t(6), g: t(7), a: t(8), tp: t(9) });
            }
        } catch (e) { console.error('parseStats', e); }
        return rows;
    }

    static parseGoalieStats(html) {
        const rows = [];
        try {
            const decoded = decodeHTML(html);
            const parts = decoded.split('<tr');
            for (let i = 1; i < parts.length; i++) {
                const row = parts[i];
                if (!row.includes('tdNormal') && !row.includes('tdOdd')) continue;
                const cells = row.split('<td');
                if (cells.length < 14) continue;
                const t = k => cells[k]?.substring(cells[k].indexOf('>') + 1).replace(/<[^>]+>/g, '').trim() || '';
                const rank = t(1), name = t(3), team = t(4);
                if (!name || name === 'Player' || name === 'Name') continue;
                rows.push({ rank, name, team, gp: t(6), sog: t(9), ga: t(10), gaa: t(11), svs: t(12), svsp: t(13) });
            }
        } catch (e) { console.error('parseGoalieStats', e); }
        return rows;
    }

    static parseEvents(html) {
        const d = { periods: [], venue: '', spectators: '', shots: null, periodScores: '', totalScore: '' };
        try {
            const decoded = decodeHTML(html);
            const vm = decoded.match(/<b>([^<]+)<\/h3>/);
            if (vm) d.venue = vm[1].trim();
            const sm = decoded.match(/Spectators:\s*(\d[\d,]*)/);
            if (sm) d.spectators = sm[1];
            const tsm = decoded.match(/(\d+\s*-\s*\d+)[\s\S]{0,30}\(([\d\s\-,]+)\)\s*<\/div>/);
            if (tsm) { d.totalScore = tsm[1].replace(/\s/g, ''); d.periodScores = tsm[2].trim(); }

            const shotRows = [...decoded.matchAll(/>Shots<\/td>[\s\S]*?<strong>(\d+)<\/strong>[\s\S]*?\(([^)]+)\)/g)];
            if (shotRows.length >= 2) d.shots = { home: { total: shotRows[0][1], periods: shotRows[0][2] }, away: { total: shotRows[1][1], periods: shotRows[1][2] } };

            const blocks = decoded.split(/<h3>(\d+.. period|Overtime|Game Winning Shot)<\/h3>/i);
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
                        for (const m of raw4.matchAll(/title=["'][^"']*Assists[^"']*["']>([^<]+)/g)) { const n = m[1].trim(); if (n && !assists.includes(n)) assists.push(n); }
                        if (assists.length) desc += ` (${assists.join(', ')})`;
                        events.push({ type: 'goal', time, score, desc });
                    } else {
                        const dur = t(2);
                        if (dur.includes('min')) {
                            const team = t(3);
                            const desc = cells[4]?.substring(cells[4].indexOf('>') + 1).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
                            events.push({ type: 'penalty', time, duration: dur, team, desc });
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
            const decoded = decodeHTML(html);
            const refMatch = decoded.match(/<strong>Referee\(s\)<\/strong><\/td>[^>]*>([^<]+)<\/td>/);
            if (refMatch) info.referees = refMatch[1].split(',').map(s => s.trim());
            const linMatch = decoded.match(/<strong>Linesmen<\/strong><\/td>[^>]*>([^<]+)<\/td>/);
            if (linMatch) info.linesmen = linMatch[1].split(',').map(s => s.trim());

            const teamBlocks = decoded.split(/class="tdSubTitle"[^>]*><h3>/i).slice(1);
            teamBlocks.forEach(block => {
                const teamName = block.split('</h3>')[0].trim();
                const lineup = { name: teamName, coach: '', roster: [] };
                const coachMatch = block.match(/<strong>Head Coach:\s*<\/strong>\s*([^<]+)<\/td>/i);
                if (coachMatch) lineup.coach = coachMatch[1].replace(/&nbsp;/g, '').trim();
                const lines = block.split(/<th[^>]*><strong>(Goalies|1st Line|2nd Line|3rd Line|4th Line|Extra Players)<\/strong><\/th>/i);
                for (let i = 1; i < lines.length; i += 2) {
                    const lineName = lines[i];
                    const content = lines[i + 1].split('</table>')[0];
                    const players = [...content.matchAll(/<div class="lineUpPlayer[^>]*>(\d+)\.\s*([^<]+)<\/div>/g)].map(m => ({
                        num: m[1], name: m[2].trim(), line: lineName
                    }));
                    lineup.roster.push(...players);
                }
                info.teams.push(lineup);
            });
        } catch (e) { console.error('parseLineups', e); }
        return info;
    }

    // Build form map from schedule games {teamName: ['w','l','d', ...] last 5}
    static buildFormMap(games) {
        const map = {};
        const finished = games.filter(g => g.status === 'Final');
        // Walk chronologically (oldest first = natural order), compute results
        for (const g of finished) {
            const h = parseInt(g.home.score) || 0;
            const a = parseInt(g.away.score) || 0;
            let hRes, aRes;
            if (h > a) { hRes = 'w'; aRes = 'l'; }
            else if (a > h) { hRes = 'l'; aRes = 'w'; }
            else { hRes = 'd'; aRes = 'd'; }
            if (!map[g.home.name]) map[g.home.name] = [];
            if (!map[g.away.name]) map[g.away.name] = [];
            map[g.home.name].push(hRes);
            map[g.away.name].push(aRes);
        }
        // Keep last 5
        for (const k in map) map[k] = map[k].slice(-5);
        return map;
    }

    // Extract H2H results between two teams from all schedule games
    static extractH2H(homeTeam, awayTeam, games) {
        return games.filter(g =>
            (g.home.name === homeTeam && g.away.name === awayTeam) ||
            (g.home.name === awayTeam && g.away.name === homeTeam)
        ).slice(-10);
    }

    static _processGame(home, away, raw, id) {
        raw = raw.trim();
        let homeScore = '0', awayScore = '0', status = 'Upcoming', time = raw;
        const sm = raw.match(/(\d+)\s*[-–]\s*(\d+)/);
        if (sm) {
            homeScore = sm[1]; awayScore = sm[2];
            const lo = raw.toLowerCase();
            if (lo.includes('period') || lo.includes('ot') || lo.includes('str') || lo.includes('live')) {
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

// ── Fetch ────────────────────────────────────────────────────────
async function fetchData() {
    clearTimeout(pollTimer);
    if (fetchController) fetchController.abort();
    fetchController = new AbortController();

    setLoading(true);
    const lid = UI.leagueSelect.value;
    let url = '';
    if (currentSection === 'games') url = `${currentView === 'live' ? CONFIG.LIVE_URL : CONFIG.SCHEDULE_URL}${lid}`;
    if (currentSection === 'standings') url = `${CONFIG.STANDINGS_URL}${lid}`;
    if (currentSection === 'stats') {
        url = (currentStatsTab === 'scorers' ? CONFIG.STATS_URL : CONFIG.GOALIE_STATS_URL) + lid;
    }

    try {
        const res = await fetch(proxy(url), { signal: fetchController.signal });
        if (!res.ok) throw new Error(res.status);
        const html = await res.text();

        if (currentSection === 'games') {
            let games;
            if (currentView === 'live') {
                games = Parser.parseLive(html);
                const liveCount = games.filter(g => g.status.toLowerCase().includes('period') || g.status.toLowerCase() === 'live').length;
                updateLiveBadge(liveCount);
                checkNotifications(games);
            } else {
                games = Parser.parseSchedule(html);
                allScheduleGames = games; // cache for form/H2H
            }
            renderGames(applySearchFilter(games));
        } else if (currentSection === 'standings') {
            const rows = Parser.parseStandings(html);
            // Fetch schedule to compute real form
            fetchFormData(lid).then(formMap => renderStandings(rows, formMap));
            renderStandings(rows, {}); // initial render with no form while fetching
            return; // early return — renderStandings called again once form ready
        } else if (currentSection === 'stats') {
            if (currentStatsTab === 'scorers') {
                renderStats(applySearchFilter(Parser.parseStats(html)));
            } else {
                renderGoalieStats(applySearchFilter(Parser.parseGoalieStats(html)));
            }
        }
        setLoading(false, true);
        UI.errorContainer.classList.add('hidden');

        const now = new Date();
        UI.lastUpdatedTime.textContent = `• Updated ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('fetchData', err);
        setLoading(false, false);
        UI.errorContainer.classList.remove('hidden');
    } finally {
        fetchController = null;
    }

    if (currentSection === 'games' && currentView === 'live') {
        pollTimer = setTimeout(fetchData, CONFIG.POLL_INTERVAL);
    }
}

async function fetchFormData(lid) {
    try {
        const res = await fetch(proxy(CONFIG.SCHEDULE_URL + lid));
        if (!res.ok) return {};
        const html = await res.text();
        const games = Parser.parseSchedule(html);
        allScheduleGames = games;
        return Parser.buildFormMap(games);
    } catch { return {}; }
}

async function fetchMatchDetails(game) {
    modalGame = game;
    UI.modalBody.innerHTML = '<div class="empty-state">Loading…</div>';
    UI.modalH2h.innerHTML = '';
    UI.modal.classList.remove('hidden');
    switchModalSection('summary');
    try {
        const [eventsRes, lineupsRes] = await Promise.all([
            fetch(proxy(CONFIG.EVENTS_URL + game.realId)),
            fetch(proxy(CONFIG.LINEUPS_URL + game.realId))
        ]);
        const eventsHtml = await eventsRes.text();
        const lineupsHtml = await lineupsRes.text();
        const details = Parser.parseEvents(eventsHtml);
        const lineups = Parser.parseLineups(lineupsHtml);
        details.matchInfo = lineups;
        renderDetails(details);
    } catch (e) {
        UI.modalBody.innerHTML = '<div class="empty-state" style="color:var(--red)">Failed to load stats.</div>';
    }
}

// ── Notification logic ────────────────────────────────────────────
function checkNotifications(games) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    for (const g of games) {
        if (!watchedGames.has(g.realId)) continue;
        const prev = lastGameSnapshot[g.realId];
        const isLive = g.status.toLowerCase().includes('period') || g.status.toLowerCase() === 'live';
        if (!prev) {
            lastGameSnapshot[g.realId] = { ...g };
            continue;
        }
        // Notify on score change
        const scoreChanged = prev.home.score !== g.home.score || prev.away.score !== g.away.score;
        if (scoreChanged && isLive) {
            new Notification('⚽ Goal!', {
                body: `${g.home.name} ${g.home.score} - ${g.away.score} ${g.away.name}`,
                icon: '🏒'
            });
        }
        // Notify when match goes live
        if (!prev.status.toLowerCase().includes('period') && !prev.status.toLowerCase().includes('live') && isLive) {
            new Notification('🏒 Game Started!', {
                body: `${g.home.name} vs ${g.away.name} is now live!`,
            });
        }
        lastGameSnapshot[g.realId] = { ...g };
    }
}

// ── Search / filter helpers ────────────────────────────────────────
function applySearchFilter(items) {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => {
        if (item.home) return item.home.name.toLowerCase().includes(q) || item.away.name.toLowerCase().includes(q);
        if (item.team) return item.team.toLowerCase().includes(q) || (item.name || '').toLowerCase().includes(q);
        if (item.name) return item.name.toLowerCase().includes(q) || item.team.toLowerCase().includes(q);
        return false;
    });
}

// ── Render ───────────────────────────────────────────────────────
function renderGames(games) {
    UI.gamesContainer.innerHTML = '';
    let displayGames = games;

    if (favoritesOnly) {
        displayGames = games.filter(g => favorites.has(g.home.name) || favorites.has(g.away.name));
    }

    if (!displayGames.length) {
        UI.gamesContainer.innerHTML = favoritesOnly
            ? '<div class="empty-state">No favorites found. ⭐ Star a team first!</div>'
            : '<div class="empty-state">No games found for this league.</div>';
        return;
    }

    const banner = document.createElement('div');
    banner.className = 'league-banner';
    banner.innerHTML = `
        <span class="lb-flag">${getLeagueFlag(UI.leagueSelect.value)}</span>
        <span class="lb-country">Sweden</span>
        <span class="lb-name">${getLeagueName(UI.leagueSelect.value)}</span>
        <span class="lb-count">${displayGames.length} game${displayGames.length !== 1 ? 's' : ''}</span>
    `;
    UI.gamesContainer.appendChild(banner);

    displayGames.forEach(g => {
        const clone = UI.gameTemplate.content.cloneNode(true);
        const row = clone.querySelector('.game-row');

        const lo = g.status.toLowerCase();
        if (lo === 'final') row.classList.add('final');
        else if (lo.includes('period') || lo === 'live') row.classList.add('live');
        else row.classList.add('scheduled');

        row.querySelector('.gr-time').textContent = g.time;
        const statusEl = row.querySelector('.gr-status');
        statusEl.textContent = g.status;
        if (row.classList.contains('live')) statusEl.classList.add('live');

        const [homeRow, awayRow] = row.querySelectorAll('.gr-team');
        const homeNameEl = homeRow.querySelector('.gr-name');
        const awayNameEl = awayRow.querySelector('.gr-name');
        homeNameEl.textContent = g.home.name;
        homeRow.querySelector('.gr-score').textContent = g.home.score;
        awayNameEl.textContent = g.away.name;
        awayRow.querySelector('.gr-score').textContent = g.away.score;

        // Favourite stars
        const [homeStar, awayStar] = row.querySelectorAll('.fav-star');
        updateStar(homeStar, g.home.name);
        updateStar(awayStar, g.away.name);
        homeStar.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(g.home.name, homeStar); });
        awayStar.addEventListener('click', e => { e.stopPropagation(); toggleFavorite(g.away.name, awayStar); });

        // Winner highlight
        if (row.classList.contains('final')) {
            const h = parseInt(g.home.score) || 0, a = parseInt(g.away.score) || 0;
            if (h > a) homeRow.classList.add('winner');
            else if (a > h) awayRow.classList.add('winner');
        }

        // Notification watch bell
        const btn = row.querySelector('.stats-btn');
        if (g.realId) {
            btn.addEventListener('click', e => { e.stopPropagation(); fetchMatchDetails(g); });
            row.addEventListener('click', () => fetchMatchDetails(g));

            // Add notification watch icon if live
            if (lo.includes('period') || lo === 'live') {
                const watchBtn = document.createElement('button');
                watchBtn.className = `watch-btn ${watchedGames.has(g.realId) ? 'watching' : ''}`;
                watchBtn.title = watchedGames.has(g.realId) ? 'Stop alerts' : 'Alert on score change';
                watchBtn.innerHTML = '🔔';
                watchBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleWatchGame(g.realId, watchBtn);
                });
                row.querySelector('.game-row-actions').prepend(watchBtn);
            }
        } else {
            btn.style.display = 'none';
        }

        UI.gamesContainer.appendChild(clone);
    });
}

function updateStar(btn, teamName) {
    const isFav = favorites.has(teamName);
    btn.textContent = isFav ? '⭐' : '☆';
    btn.classList.toggle('fav-active', isFav);
}

function toggleFavorite(teamName, starBtn) {
    if (favorites.has(teamName)) {
        favorites.delete(teamName);
    } else {
        favorites.add(teamName);
    }
    saveFavorites();
    updateStar(starBtn, teamName);
    // If filtering, re-render
    if (favoritesOnly) fetchData();
}

function toggleWatchGame(gameId, btn) {
    if (watchedGames.has(gameId)) {
        watchedGames.delete(gameId);
        btn.classList.remove('watching');
    } else {
        watchedGames.add(gameId);
        btn.classList.add('watching');
    }
}

function getLeagueName(id) {
    const opt = UI.leagueSelect.querySelector(`option[value="${id}"]`);
    return opt ? opt.textContent : 'Leagues';
}

function getLeagueFlag(id) {
    return '🇸🇪';
}

function renderStandings(rows, formMap = {}) {
    UI.standingsBody.innerHTML = '';
    if (!rows.length) { UI.standingsBody.innerHTML = '<tr><td colspan="10" class="empty-state">No data.</td></tr>'; return; }

    let filtered = rows;
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = rows.filter(r => r.team.toLowerCase().includes(q));
    }

    filtered.forEach((r, idx) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => showTeamStats(r.team));

        // Real form from schedule (or fallback empty)
        const formArr = formMap[r.team] || [];
        const forms = formArr.length
            ? formArr.map(f => `<span class="form-dot form-${f}">${f}</span>`).join('')
            : '<span class="form-dot form-d" style="opacity:.3">?</span>'.repeat(5);

        const isFav = favorites.has(r.team);
        tr.innerHTML = `<td class="col-rank">${r.rank}</td>
            <td class="text-left"><strong>${r.team}</strong></td>
            <td>${r.gp}</td><td>${r.w}</td><td>${r.tie}</td><td>${r.l}</td>
            <td class="col-gd">${r.gd}</td>
            <td class="tp-cell">${r.tp}</td>
            <td><div class="form-cell">${forms}</div></td>
            <td class="fav-cell"><button class="fav-star standings-fav" data-team="${r.team}">${isFav ? '⭐' : '☆'}</button></td>`;
        UI.standingsBody.appendChild(tr);
    });

    // Wire star buttons
    UI.standingsBody.querySelectorAll('.standings-fav').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const team = btn.dataset.team;
            if (favorites.has(team)) { favorites.delete(team); btn.textContent = '☆'; }
            else { favorites.add(team); btn.textContent = '⭐'; }
            saveFavorites();
        });
    });

    setLoading(false, true);
    UI.errorContainer.classList.add('hidden');
    const now = new Date();
    UI.lastUpdatedTime.textContent = `• Updated ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

async function showTeamStats(teamName) {
    currentSection = 'stats';
    currentStatsTab = 'scorers';
    const sections = [UI.sectionGames, UI.sectionStandings, UI.sectionStats];
    sections.forEach(el => el.classList.remove('active-section'));
    UI.sectionStats.classList.add('active-section');
    document.querySelectorAll('.nav-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.section === 'stats'));
    UI.statsScorersBtn.classList.add('active-sub');
    UI.statsGoaliesBtn.classList.remove('active-sub');
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

function renderStats(rows) {
    UI.statsHeader.innerHTML = `<th class="col-rank">#</th><th class="text-left">Player</th><th class="col-team-name text-left">Team</th><th title="Games Played">GP</th><th title="Goals">G</th><th title="Assists">A</th><th title="Total Points"><strong>TP</strong></th>`;
    UI.statsBody.innerHTML = '';
    if (!rows.length) { UI.statsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No data.</td></tr>'; return; }
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="col-rank">${r.rank}</td>
            <td class="text-left"><strong>${r.name}</strong></td>
            <td class="col-team-name text-left">${r.team}</td>
            <td>${r.gp}</td><td>${r.g}</td><td>${r.a}</td>
            <td class="tp-cell">${r.tp}</td>`;
        UI.statsBody.appendChild(tr);
    });
}

function renderGoalieStats(rows) {
    UI.statsHeader.innerHTML = `<th class="col-rank">#</th><th class="text-left">Goalie</th><th class="col-team-name text-left">Team</th><th>GP</th><th>SOG</th><th>GA</th><th>GAA</th><th class="tp-cell">SVS%</th>`;
    UI.statsBody.innerHTML = '';
    if (!rows.length) { UI.statsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No data.</td></tr>'; return; }
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="col-rank">${r.rank}</td>
            <td class="text-left"><strong>${r.name}</strong></td>
            <td class="col-team-name text-left">${r.team}</td>
            <td>${r.gp}</td><td>${r.sog}</td><td>${r.ga}</td><td>${r.gaa}</td>
            <td class="tp-cell">${r.svsp}</td>`;
        UI.statsBody.appendChild(tr);
    });
}

function updateLiveBadge(count) {
    let badge = $('nav-games-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.id = 'nav-games-badge';
        badge.className = 'nav-badge';
        $('nav-games').appendChild(badge);
    }
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderDetails(d) {
    let html = `<div class="modal-match-header">
        <div class="modal-venue">${d.venue || 'Unknown Venue'}</div>
        <div class="modal-score-row">
            <span class="modal-total-score">${d.totalScore || '—'}</span>
            <span class="modal-period-scores">${d.periodScores ? `(${d.periodScores})` : ''}</span>
        </div>
        <div class="modal-spectators">${d.spectators ? `👥 ${parseInt(d.spectators).toLocaleString()} spectators` : ''}</div>
    </div>`;

    if (d.shots) {
        const hS = parseInt(d.shots.home.total) || 0, aS = parseInt(d.shots.away.total) || 0;
        const pct = Math.round(hS / (hS + aS || 1) * 100);
        html += `<div class="shots-box">
            <div class="shots-label">Shots on Goal</div>
            <div class="shots-row">
                <span class="shots-home">${hS}</span>
                <div class="shots-bar-track"><div class="shots-bar-fill" style="width:${pct}%"></div></div>
                <span class="shots-away">${aS}</span>
            </div>
            <div class="shots-periods">${d.shots.home.periods} &nbsp;|&nbsp; ${d.shots.away.periods}</div>
        </div>`;
    }

    if (!d.periods.length) html += '<div class="empty-state">No events recorded.</div>';

    [...d.periods].reverse().forEach(p => {
        html += `<div class="period-summary">
            <div class="period-title">${p.title}</div>
            ${p.events.map(e => e.type === 'goal'
            ? `<div class="event-row goal"><div class="event-marker">${e.time}</div><div class="event-main"><span class="score-chip">${e.score}</span><span class="event-desc">${e.desc}</span></div></div>`
            : `<div class="event-row penalty"><div class="event-marker">${e.time}</div><div class="event-main"><span class="penalty-chip">${e.duration}</span><span class="event-desc">${e.team ? `[${e.team}] ` : ''}${e.desc}</span></div></div>`
        ).join('')}
        </div>`;
    });

    if (d.matchInfo && (d.matchInfo.referees.length || d.matchInfo.homeCoach)) {
        html += `<div class="match-info-section">
            <div class="period-title" style="margin-top: 24px;">Match Info</div>
            <div class="info-grid">`;
        if (d.matchInfo.referees?.length) html += `<div class="info-item"><span class="info-label">Referees</span><span class="info-val">${d.matchInfo.referees.join(', ')}</span></div>`;
        if (d.matchInfo.linesmen?.length) html += `<div class="info-item"><span class="info-label">Linesmen</span><span class="info-val">${d.matchInfo.linesmen.join(', ')}</span></div>`;
        if (d.matchInfo.homeCoach || d.matchInfo.awayCoach) html += `<div class="info-item"><span class="info-label">Coaches</span><span class="info-val">${d.matchInfo.homeCoach || 'N/A'} &nbsp;|&nbsp; ${d.matchInfo.awayCoach || 'N/A'}</span></div>`;
        html += `</div></div>`;
    }

    UI.modalBody.innerHTML = html;
    renderLineups(d.matchInfo);

    // Render H2H
    if (modalGame) renderH2H(modalGame);
}

function renderLineups(info) {
    if (!info || !info.teams || !info.teams.length) {
        UI.modalLineups.innerHTML = '<div class="empty-state">Lineup data not available for this game yet.</div>';
        return;
    }
    let html = '';
    info.teams.forEach(team => {
        html += `<div class="lineup-team">
            <div class="lineup-team-header">${team.name} <span class="coach-label">(Coach: ${team.coach || 'N/A'})</span></div>
            <div class="lineup-grid">`;
        const lines = ['Goalies', '1st Line', '2nd Line', '3rd Line', '4th Line', 'Extra Players'];
        lines.forEach(line => {
            const players = team.roster.filter(p => p.line === line);
            if (players.length) {
                html += `<div class="lineup-row">
                    <div class="line-label">${line}</div>
                    <div class="players-list">
                        ${players.map(p => `<span class="player-chip"><i>${p.num}</i> ${p.name}</span>`).join('')}
                    </div>
                </div>`;
            }
        });
        html += `</div></div>`;
    });
    UI.modalLineups.innerHTML = html;
}

function renderH2H(game) {
    const h2hGames = Parser.extractH2H(game.home.name, game.away.name, allScheduleGames);
    if (!h2hGames.length) {
        UI.modalH2h.innerHTML = `<div class="empty-state">No recent H2H data available.<br><small>Load "Past Results" first to populate this.</small></div>`;
        return;
    }
    let html = `<div class="h2h-header">
        <span class="h2h-team-name">${game.home.name}</span>
        <span class="h2h-vs">vs</span>
        <span class="h2h-team-name">${game.away.name}</span>
    </div>
    <div class="h2h-list">`;
    [...h2hGames].reverse().forEach(g => {
        const winner = parseInt(g.home.score) > parseInt(g.away.score) ? 'home' : parseInt(g.away.score) > parseInt(g.home.score) ? 'away' : 'draw';
        html += `<div class="h2h-row">
            <span class="h2h-result-team ${winner === 'home' ? 'h2h-winner' : ''}">${g.home.name}</span>
            <span class="h2h-score">${g.home.score} - ${g.away.score}</span>
            <span class="h2h-result-team ${winner === 'away' ? 'h2h-winner' : ''}">${g.away.name}</span>
        </div>`;
    });
    html += '</div>';
    UI.modalH2h.innerHTML = html;
}

function switchModalSection(section) {
    UI.modalBody.classList.toggle('hidden', section !== 'summary');
    UI.modalLineups.classList.toggle('hidden', section !== 'lineups');
    UI.modalH2h.classList.toggle('hidden', section !== 'h2h');
    document.querySelectorAll('.modal-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.modalSection === section);
    });
}

function switchStatsTab(tab) {
    currentStatsTab = tab;
    UI.statsScorersBtn.classList.toggle('active-sub', tab === 'scorers');
    UI.statsGoaliesBtn.classList.toggle('active-sub', tab === 'goalies');
    fetchData();
}

// ── Navigation ───────────────────────────────────────────────────
function switchSection(section) {
    currentSection = section;
    [UI.sectionGames, UI.sectionStandings, UI.sectionStats].forEach(el => el.classList.remove('active-section'));
    const map = { games: UI.sectionGames, standings: UI.sectionStandings, stats: UI.sectionStats };
    map[section].classList.add('active-section');
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === section);
    });
    // Show/hide date nav
    UI.dateNav.style.display = section === 'games' ? 'flex' : 'none';
    fetchData();
}

// ── Date navigator ───────────────────────────────────────────────
function updateDateDisplay() {
    UI.dateDisplay.textContent = formatDateDisplay(currentDate);
    const isToday = isSameDay(currentDate, today());
    UI.dateTodayBtn.classList.toggle('date-label-btn--today', isToday);
}

UI.datePrevBtn.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 1);
    updateDateDisplay();
    fetchData();
});

UI.dateNextBtn.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 1);
    updateDateDisplay();
    fetchData();
});

UI.dateTodayBtn.addEventListener('click', () => {
    currentDate = today();
    updateDateDisplay();
    fetchData();
});

// ── Search ───────────────────────────────────────────────────────
UI.searchToggleBtn.addEventListener('click', () => {
    UI.searchWrap.classList.toggle('search-open');
    if (UI.searchWrap.classList.contains('search-open')) {
        UI.searchInput.focus();
    } else {
        UI.searchInput.value = '';
        searchQuery = '';
        UI.searchClearBtn.classList.add('hidden');
        fetchData();
    }
});

UI.searchInput.addEventListener('input', () => {
    const val = UI.searchInput.value.trim();
    UI.searchClearBtn.classList.toggle('hidden', !val);
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        searchQuery = val;
        fetchData();
    }, 250);
});

UI.searchClearBtn.addEventListener('click', () => {
    UI.searchInput.value = '';
    searchQuery = '';
    UI.searchClearBtn.classList.add('hidden');
    UI.searchInput.focus();
    fetchData();
});

// ── Theme toggle ─────────────────────────────────────────────────
function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    UI.themeIconDark.classList.toggle('hidden', theme === 'light');
    UI.themeIconLight.classList.toggle('hidden', theme === 'dark');
}

UI.themeBtn.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// ── Notifications ────────────────────────────────────────────────
UI.notifyBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
        alert('Notifications not supported in this browser.');
        return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
        UI.notifyBtn.classList.add('notify-active');
        UI.notifyBtn.title = 'Notifications enabled';
        new Notification('🏒 Swehockey Live', { body: 'Score alerts are now enabled!' });
    }
});

// ── Favorites filter ─────────────────────────────────────────────
UI.favoritesFilterBtn.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    UI.favoritesFilterBtn.classList.toggle('active-sub', favoritesOnly);
    fetchData();
});

// ── Scroll to top ────────────────────────────────────────────────
window.addEventListener('scroll', () => {
    UI.scrollTopBtn.classList.toggle('hidden', window.scrollY < 300);
}, { passive: true });

UI.scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Helpers ──────────────────────────────────────────────────────
function setLoading(on, success = false) {
    UI.statusText.textContent = on ? 'Updating…' : (success ? 'Live' : 'Error');
    UI.statusPill.className = `status-pill ${success ? 'connected' : (on ? '' : 'error')}`;
    UI.refreshBtn.classList.toggle('spinning', on);

    if (success && currentSection === 'games' && currentView === 'live') {
        UI.statusPill.classList.add('live-pulsing');
    } else {
        UI.statusPill.classList.remove('live-pulsing');
    }

    if (on) {
        if (currentSection === 'games') {
            UI.gamesContainer.innerHTML = '';
            for (let i = 0; i < 6; i++) UI.gamesContainer.appendChild(UI.skeletonGameTemplate.content.cloneNode(true));
        } else if (currentSection === 'standings') {
            UI.standingsBody.innerHTML = '';
            for (let i = 0; i < 14; i++) UI.standingsBody.appendChild(UI.skeletonTableTemplate.content.cloneNode(true));
        } else if (currentSection === 'stats') {
            UI.statsBody.innerHTML = '';
            for (let i = 0; i < 10; i++) UI.statsBody.appendChild(UI.skeletonTableTemplate.content.cloneNode(true));
        }
    }
}

// ── Event Listeners ──────────────────────────────────────────────
UI.leagueSelect.addEventListener('change', fetchData);
UI.refreshBtn.addEventListener('click', fetchData);

UI.liveBtn.addEventListener('click', () => {
    currentView = 'live';
    UI.liveBtn.classList.add('active-sub');
    UI.scheduleBtn.classList.remove('active-sub');
    fetchData();
});

UI.scheduleBtn.addEventListener('click', () => {
    currentView = 'schedule';
    UI.scheduleBtn.classList.add('active-sub');
    UI.liveBtn.classList.remove('active-sub');
    fetchData();
});

UI.statsScorersBtn.addEventListener('click', () => switchStatsTab('scorers'));
UI.statsGoaliesBtn.addEventListener('click', () => switchStatsTab('goalies'));

document.querySelectorAll('.modal-tab').forEach(btn => {
    btn.addEventListener('click', e => switchModalSection(e.target.dataset.modalSection));
});

document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', e => switchSection(e.target.dataset.section));
});

UI.closeModal.addEventListener('click', () => {
    UI.modal.classList.add('hidden');
    switchModalSection('summary');
});
UI.backdrop.addEventListener('click', () => {
    UI.modal.classList.add('hidden');
    switchModalSection('summary');
});

UI.retryBtn.addEventListener('click', fetchData);

// ── Init ─────────────────────────────────────────────────────────
applyTheme(currentTheme);
updateDateDisplay();
fetchData();
