#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const USER_ID = process.env.DOUBAN_USER_ID || "55478423";
const OUTPUT = process.env.DOUBAN_BOOKS_OUTPUT || "data/douban_books.json";
const COOKIE = process.env.DOUBAN_COOKIE || "";
const COOKIE_FILE = process.env.DOUBAN_COOKIE_FILE || "";
const PAGE_SIZE = Number(process.env.DOUBAN_PAGE_SIZE || 30);
const MAX_BOOKS = Number(process.env.DOUBAN_MAX_BOOKS || 2000);
const WAIT_MS = Number(process.env.DOUBAN_WAIT_MS || 1200);
const RETRIES = Number(process.env.DOUBAN_RETRIES || 4);
const TIMEOUT_MS = Number(process.env.DOUBAN_TIMEOUT_MS || 20000);
const COVER_RETRIES = Number(process.env.DOUBAN_COVER_RETRIES || 1);
const COVER_TIMEOUT_MS = Number(process.env.DOUBAN_COVER_TIMEOUT_MS || 12000);
const START = Number(process.env.DOUBAN_START || 0);
const FULL_SYNC = process.argv.includes("--full") || process.env.DOUBAN_FULL === "1";
const PAGE_LIMIT = FULL_SYNC ? Infinity : Number(process.env.DOUBAN_PAGE_LIMIT || Infinity);
const SAVE_HTML = process.env.DOUBAN_SAVE_HTML === "1";
const DEBUG_DIR = process.env.DOUBAN_DEBUG_DIR || ".cache/douban";
const COVER_DIR = process.env.DOUBAN_COVER_DIR || "static/images/douban";
const COVER_PUBLIC_DIR = process.env.DOUBAN_COVER_PUBLIC_DIR || "/images/douban";
const DOWNLOAD_COVERS = process.env.DOUBAN_DOWNLOAD_COVERS !== "false";
const FORCE_REFRESH = process.env.DOUBAN_FORCE === "1" || process.argv.includes("--force");
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const execFileAsync = promisify(execFile);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeHtml(value = "") {
    return value
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(value = "") {
    return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function absolutize(url = "") {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (url.startsWith("http://")) return url.replace(/^http:/, "https:");
    return url;
}

function getAttr(html, name) {
    const match = html.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
    return match ? decodeHtml(match[1]) : "";
}

function pickImageUrl(img = "") {
    const attrs = ["data-original", "data-src", "data-lazy", "src"];
    for (const attr of attrs) {
        const value = getAttr(img, attr);
        if (value && !/default|blank|spacer|grey|empty/i.test(value)) return absolutize(value);
    }

    const srcset = getAttr(img, "srcset");
    if (srcset) {
        const first = srcset.split(",").map((item) => item.trim().split(/\s+/)[0]).find(Boolean);
        if (first) return absolutize(first);
    }

    return "";
}

function normalizeCover(url = "") {
    const cover = absolutize(url);
    if (!cover) return "";
    return cover.replace(/\/view\/subject\/[sml]\/public\//, "/view/subject/l/public/");
}

function coverUrlCandidates(url = "") {
    const normalized = normalizeCover(url);
    if (!normalized) return [];

    const candidates = new Set([normalized]);
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        return [normalized];
    }

    const hosts = [parsed.hostname, "img1.doubanio.com", "img2.doubanio.com", "img3.doubanio.com", "img9.doubanio.com"];
    const sizes = ["l", "m", "s"];
    for (const host of hosts) {
        for (const size of sizes) {
            const next = new URL(normalized);
            next.hostname = host;
            next.pathname = next.pathname.replace(/\/view\/subject\/[sml]\//, `/view/subject/${size}/`);
            candidates.add(next.toString());
            if (next.protocol === "https:") {
                next.protocol = "http:";
                candidates.add(next.toString());
            }
        }
    }

    return [...candidates];
}

function isLikelyImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 100) return false;
    const header = buffer.subarray(0, 16);
    return (
        header[0] === 0xff && header[1] === 0xd8
        || header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        || header.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP"
        || header.subarray(0, 3).toString() === "GIF"
    );
}

function subjectId(url = "") {
    const match = url.match(/subject\/(\d+)/);
    return match ? match[1] : "";
}

function localCoverPath(cover = "") {
    if (!cover.startsWith(`${COVER_PUBLIC_DIR.replace(/\/$/, "")}/`)) return "";
    const fileName = cover.split("/").pop();
    return fileName ? path.join(COVER_DIR, fileName) : "";
}

function escapeRegExp(value = "") {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchTagByClassToken(html = "", tag = "div", token = "") {
    const pattern = new RegExp(`<${tag}[^>]*class=["']([^"']*)["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    for (const match of html.matchAll(pattern)) {
        const classes = match[1].split(/\s+/).filter(Boolean);
        if (classes.includes(token)) return match[2];
    }
    return "";
}

function extractInfoField(infoText, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = infoText.match(new RegExp(`(?:^|\\n)${escaped}:\\s*([^\\n]+)`, "i"));
    return match ? match[1].trim() : "";
}

function normalizeInfoText(info = "") {
    return stripTags(info)
        .replace(/\s*(作者|出版社|出品方|副标题|原作名|译者|出版年|页数|定价|装帧|丛书|ISBN)\s*:/g, "\n$1:")
        .replace(/\n+/g, "\n")
        .trim();
}

function extractComment(item = "") {
    const direct = matchTagByClassToken(item, "p", "comment")
        || matchTagByClassToken(item, "div", "comment")
        || matchTagByClassToken(item, "span", "comment");
    if (direct) return stripTags(direct);

    const shortNote = item.match(/<div[^>]*class=["'][^"']*short-note[^"']*["'][^>]*>([\s\S]*?)(?=<\/li>|<div[^>]*class=["'][^"']*ft[^"']*["']|$)/i)?.[1] || "";
    const noteParagraph = shortNote.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
    const comment = stripTags(noteParagraph)
        .replace(/^(?:评价|短评)\s*[:：]\s*/, "")
        .trim();

    return comment;
}

function extractReadDate(item = "") {
    const dateText = stripTags(
        item.match(/<span[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
        || item.match(/<div[^>]*class=["'][^"']*date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
        || ""
    );
    return dateText.match(/\d{4}-\d{2}-\d{2}/)?.[0] || dateText;
}

function parseCommentMap(html) {
    const comments = new Map();
    const pattern = /<div[^>]+id=["']grid(\d+)["'][^>]*class=["'][^"']*comment-item[^"']*["'][^>]*>[\s\S]*?(?=<li[^>]+id=["']list\d+["']|<div[^>]+id=["']grid\d+["']|<\/ul>|<\/ol>|$)/gi;
    for (const match of html.matchAll(pattern)) {
        const id = match[1];
        const block = match[0];
        const comment = extractComment(block);
        if (comment) comments.set(id, comment);
    }
    return comments;
}

function extractSubjectCount(html) {
    const text = stripTags(html.match(/<span[^>]*class=["'][^"']*subject-num[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const numbers = text.match(/\d+/g);
    return numbers ? Number(numbers[numbers.length - 1]) : null;
}

function extractNextStart(html) {
    const nextHref = html.match(/<span[^>]*class=["'][^"']*next[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
        || html.match(/<link[^>]+rel=["']next["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
        || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']next["'][^>]*>/i)?.[1]
        || "";
    const start = decodeHtml(nextHref).match(/[?&]start=(\d+)/)?.[1];
    return start ? Number(start) : null;
}

function splitItems(html) {
    const blocks = [];
    const patterns = [
        /<li[^>]+id=["']list\d+["'][^>]*class=["'][^"']*item[^"']*["'][^>]*>[\s\S]*?(?=<li[^>]+id=["']list\d+["']|<div[^>]*class=["']paginator|<\/ol>|<\/ul>|$)/gi,
        /<li[^>]*class=["'][^"']*subject-item[^"']*["'][^>]*>[\s\S]*?(?=<li[^>]*class=["'][^"']*subject-item[^"']*["']|<div[^>]*class=["']paginator|<\/ol>|<\/ul>|$)/gi,
        /<div[^>]*class=["'][^"']*item[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*item[^"']*["']|<div[^>]*class=["']paginator|$)/gi,
    ];

    for (const pattern of patterns) {
        const matches = html.match(pattern) || [];
        matches.forEach((item) => {
            if (/book\.douban\.com\/subject\/\d+/.test(item)) blocks.push(item);
        });
        if (blocks.length) break;
    }

    return blocks;
}

function parseBook(item) {
    const linkMatches = [...item.matchAll(/<a[^>]+href=["']([^"']*book\.douban\.com\/subject\/\d+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const linkMatch = linkMatches.find((match) => getAttr(match[0], "title") || stripTags(match[2])) || linkMatches[0];
    const imageMatch = item.match(/<img[^>]+>/i);
    const pubMatch = item.match(/<div[^>]*class=["'][^"']*pub[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    const introMatch = item.match(/<span[^>]*class=["'][^"']*intro[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const ratingMatch = item.match(/rating(\d)-t/i);

    const url = absolutize(linkMatch ? linkMatch[1] : "");
    const title = stripTags(getAttr(linkMatch ? linkMatch[0] : "", "title") || (linkMatch ? linkMatch[2] : ""));
    if (!url || !title) return null;

    const pub = stripTags((pubMatch ? pubMatch[1] : "") || (introMatch ? introMatch[1] : ""));
    const parts = pub.split("/").map((part) => part.trim()).filter(Boolean);

    return {
        title,
        url,
        cover: normalizeCover(imageMatch ? pickImageUrl(imageMatch[0]) : ""),
        author: parts[0] || "",
        meta: parts.slice(1).join(" / "),
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        readDate: extractReadDate(item),
        comment: extractComment(item),
    };
}

async function writeBooks(books) {
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, `${JSON.stringify(books, null, 2)}\n`);
}

function appendExistingTail(syncedBooks, existingBooks) {
    if (FULL_SYNC || FORCE_REFRESH || !existingBooks.size) return syncedBooks.slice(0, MAX_BOOKS);

    const syncedUrls = new Set(syncedBooks.map((book) => book.url).filter(Boolean));
    const existingTail = [...existingBooks.values()].filter((book) => book && book.url && !syncedUrls.has(book.url));
    return [...syncedBooks, ...existingTail].slice(0, MAX_BOOKS);
}

async function loadExistingBooks() {
    try {
        const books = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
        if (!Array.isArray(books)) return new Map();
        return new Map(books.filter((book) => book && book.url).map((book) => [book.url, book]));
    } catch {
        return new Map();
    }
}

async function fileExists(file) {
    if (!file) return false;
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

async function hasUsableCover(book) {
    if (!book.cover) return false;
    if (!DOWNLOAD_COVERS) return true;
    const coverPath = localCoverPath(book.cover);
    return coverPath ? await fileExists(coverPath) : false;
}

async function isBookComplete(book) {
    return Boolean(
        book
        && book.title
        && book.url
        && book.author
        && book.readDate
        && await hasUsableCover(book)
    );
}

function mergeBook(existing, parsed, pageComment) {
    return {
        ...existing,
        title: parsed.title || existing.title,
        url: existing.url || parsed.url,
        author: parsed.author || existing.author,
        meta: parsed.meta || existing.meta || "",
        rating: parsed.rating ?? existing.rating ?? null,
        readDate: parsed.readDate || existing.readDate || "",
        comment: pageComment || existing.comment || "",
    };
}

async function writeDebugHtml(start, html) {
    if (!SAVE_HTML) return;
    await fs.mkdir(DEBUG_DIR, { recursive: true });
    const file = path.join(DEBUG_DIR, `collect-start-${start}.html`);
    await fs.writeFile(file, html);
    console.log(`Saved raw HTML to ${file}`);
}

function coverHeaders() {
    return {
        "User-Agent": USER_AGENT,
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": "https://book.douban.com/",
        "Connection": "close",
    };
}

async function downloadWithNativeHttp(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (error) {
            reject(error);
            return;
        }

        const client = parsed.protocol === "http:" ? http : https;
        const request = client.request(parsed, {
            headers: coverHeaders(),
            timeout: COVER_TIMEOUT_MS,
        }, (response) => {
            const location = response.headers.location;
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && location && redirects < 3) {
                response.resume();
                downloadWithNativeHttp(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
                return;
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolve(Buffer.concat(chunks)));
        });

        request.on("timeout", () => {
            request.destroy(new Error("timeout"));
        });
        request.on("error", reject);
        request.end();
    });
}

async function downloadWithCurl(url) {
    const { stdout } = await execFileAsync("curl", [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--max-time",
        String(Math.ceil(COVER_TIMEOUT_MS / 1000)),
        "-A",
        USER_AGENT,
        "-e",
        "https://book.douban.com/",
        url,
    ], {
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
}

async function tryDownloadImage(url, title) {
    const methods = [
        ["fetch", () => fetchText(url, coverHeaders(), `封面 ${title} fetch`, "arrayBuffer", COVER_RETRIES, COVER_TIMEOUT_MS).then((bytes) => Buffer.from(bytes))],
        ["native", () => downloadWithNativeHttp(url)],
        ["curl", () => downloadWithCurl(url)],
    ];

    const errors = [];
    for (const [name, method] of methods) {
        try {
            const bytes = await method();
            if (isLikelyImage(bytes)) return { bytes, method: name, url };
            errors.push(`${name}: not an image`);
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
        }
    }

    throw new Error(errors.join("; "));
}

async function downloadCover(book) {
    const remoteCover = book.remoteCover || (book.cover && !localCoverPath(book.cover) ? book.cover : "");
    if (!DOWNLOAD_COVERS || !remoteCover) return book;

    const id = subjectId(book.url);
    if (!id) return book;

    let ext = ".jpg";
    try {
        const parsed = new URL(remoteCover);
        const urlExt = path.extname(parsed.pathname).toLowerCase();
        if ([".jpg", ".jpeg", ".png", ".webp"].includes(urlExt)) ext = urlExt;
    } catch {
        // Keep jpg fallback for unusual image URLs.
    }

    const fileName = `${id}${ext}`;
    const outputPath = path.join(COVER_DIR, fileName);
    const publicPath = `${COVER_PUBLIC_DIR.replace(/\/$/, "")}/${fileName}`;

    try {
        await fs.access(outputPath);
        return { ...book, cover: publicPath, remoteCover: book.remoteCover || book.cover };
    } catch {
        // Continue and download.
    }

    const candidates = coverUrlCandidates(remoteCover);
    const errors = [];
    for (const candidate of candidates) {
        try {
            const result = await tryDownloadImage(candidate, book.title);
            await fs.mkdir(COVER_DIR, { recursive: true });
            await fs.writeFile(outputPath, result.bytes);
            if (candidate !== remoteCover || result.method !== "fetch") {
                console.log(`Cover downloaded for ${book.title} via ${result.method}: ${candidate}`);
            }
            return { ...book, cover: publicPath, remoteCover };
        } catch (error) {
            errors.push(`${candidate}: ${error.message}`);
        }
    }

    console.warn(`Skip cover download for ${book.title}: ${errors.slice(0, 3).join(" | ")}${errors.length > 3 ? " | ..." : ""}`);
    return { ...book, cover: remoteCover, remoteCover };
}

function printPageSummary(start, books) {
    console.log(`\nPage start=${start}, parsed ${books.length} books:`);
    books.forEach((book, index) => {
        const comment = book.comment ? `${book.comment.slice(0, 28)}${book.comment.length > 28 ? "..." : ""}` : "-";
        const fields = [
            `${index + 1}. ${book.title}`,
            `author=${book.author || "-"}`,
            `rating=${book.rating || "-"}`,
            `date=${book.readDate || "-"}`,
            `cover=${book.cover || "-"}`,
            `comment=${comment}`,
        ];
        console.log(fields.join(" | "));
    });
    console.log("");
}

function parseBookDetail(html, book) {
    const mainPic = html.match(/<div[^>]+id=["']mainpic["'][\s\S]*?<\/div>/i)?.[0] || "";
    const photo = mainPic.match(/<img[^>]+>/i)?.[0] || html.match(/<img[^>]+rel=["']v:photo["'][^>]*>/i)?.[0] || "";
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i)?.[1]
        || "";
    const title = stripTags(html.match(/<h1[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/h1>/i)?.[1] || "");
    const info = html.match(/<div[^>]+id=["']info["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "";
    const infoText = normalizeInfoText(info);
    const author = extractInfoField(infoText, "作者");
    const cover = normalizeCover(
        ogImage
        || (photo ? pickImageUrl(photo) : "")
    );

    return {
        ...book,
        title: book.title || title,
        cover: book.cover || cover,
        author: book.author || author,
    };
}

async function fetchText(url, headers, label, responseType = "text", retries = RETRIES, timeoutMs = TIMEOUT_MS) {
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                headers,
                signal: controller.signal,
            });

            if (!response.ok) {
                const hint = response.status === 403
                    ? "\n豆瓣拒绝了无登录态/脚本请求。请设置 DOUBAN_COOKIE 或 DOUBAN_COOKIE_FILE 后重试。"
                    : "";
                throw new Error(`${label}失败: ${response.status} ${response.statusText}${hint}`);
            }

            return responseType === "arrayBuffer" ? await response.arrayBuffer() : await response.text();
        } catch (error) {
            lastError = error;
            const isLastAttempt = attempt === retries;
            if (isLastAttempt) break;

            const delay = WAIT_MS * attempt;
            console.warn(`${label}中断，${delay}ms 后重试 (${attempt}/${retries}): ${error.message}`);
            await sleep(delay);
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError;
}

async function fetchPage(start) {
    const url = `https://book.douban.com/people/${USER_ID}/collect?start=${start}&sort=time&rating=all&filter=all&mode=list`;
    const cookie = COOKIE || (COOKIE_FILE ? (await fs.readFile(COOKIE_FILE, "utf8")).trim() : "");
    const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": `https://book.douban.com/people/${USER_ID}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Upgrade-Insecure-Requests": "1",
        "Connection": "close",
    };

    if (cookie) headers.Cookie = cookie;

    return fetchText(url, headers, `列表页 start=${start} 请求`);
}

async function fetchHtml(url) {
    const cookie = COOKIE || (COOKIE_FILE ? (await fs.readFile(COOKIE_FILE, "utf8")).trim() : "");
    const headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": `https://book.douban.com/people/${USER_ID}/`,
        "Connection": "close",
    };
    if (cookie) headers.Cookie = cookie;
    return fetchText(url, headers, `详情页 ${url} 请求`);
}

async function main() {
    const books = [];
    const seen = new Set();
    const existingBooks = await loadExistingBooks();
    let pagesFetched = 0;
    let expectedTotal = null;
    let start = START;
    let reused = 0;
    let reachedExistingBoundary = false;

    if (FULL_SYNC) {
        console.log("Running full sync.");
    } else if (Number.isFinite(PAGE_LIMIT)) {
        console.log(`Running incremental sync with page limit ${PAGE_LIMIT}. Use --full or DOUBAN_FULL=1 for all pages.`);
    } else {
        console.log("Running incremental sync until the first complete existing book is found. Use --full or DOUBAN_FULL=1 for all pages.");
    }
    if (existingBooks.size && !FORCE_REFRESH) {
        console.log(`Loaded ${existingBooks.size} existing books. Complete entries will be reused.`);
    }
    if (FORCE_REFRESH) {
        console.log("Force refresh enabled. Existing entries will not be reused.");
    }

    while (books.length < MAX_BOOKS) {
        if (pagesFetched >= PAGE_LIMIT) break;

        const html = await fetchPage(start);
        await writeDebugHtml(start, html);
        expectedTotal = expectedTotal || extractSubjectCount(html);
        const commentMap = parseCommentMap(html);
        const pageBooks = splitItems(html).map(parseBook).filter(Boolean);
        const fresh = pageBooks.filter((book) => {
            if (seen.has(book.url)) return false;
            seen.add(book.url);
            return true;
        });
        const pageResults = [];

        for (const book of fresh) {
            const id = subjectId(book.url);
            const pageComment = book.comment || commentMap.get(id) || "";
            const existing = existingBooks.get(book.url);
            if (!FORCE_REFRESH && existing && await isBookComplete(existing)) {
                if (!FULL_SYNC) {
                    console.log(`Stop incremental sync at existing book: ${existing.title || book.title}`);
                    reachedExistingBoundary = true;
                    break;
                }

                const reusedBook = mergeBook(existing, book, pageComment);
                books.push(reusedBook);
                pageResults.push(reusedBook);
                reused += 1;
                continue;
            }

            let enriched = {
                ...book,
                comment: pageComment,
            };
            if (!enriched.cover || !enriched.author) {
                try {
                    enriched = parseBookDetail(await fetchHtml(book.url), book);
                    enriched.comment = enriched.comment || commentMap.get(id) || "";
                    await sleep(Math.max(300, Math.floor(WAIT_MS / 2)));
                } catch (error) {
                    console.warn(`Skip detail enrichment for ${book.title}: ${error.message}`);
                }
            }
            enriched = await downloadCover(enriched);
            books.push(enriched);
            pageResults.push(enriched);
        }
        pagesFetched += 1;
        printPageSummary(start, pageResults);
        books.length = Math.min(books.length, MAX_BOOKS);
        const mergedBooks = appendExistingTail(books, existingBooks);
        await writeBooks(mergedBooks);
        console.log(`Wrote ${mergedBooks.length}${expectedTotal ? `/${expectedTotal}` : ""} books to ${OUTPUT}${reused ? ` (${reused} reused)` : ""}`);

        const nextStart = extractNextStart(html);
        if (reachedExistingBoundary) break;
        if (books.length >= MAX_BOOKS) break;
        if (nextStart === null) break;
        if (nextStart <= start) {
            console.warn(`Stop because next start (${nextStart}) is not greater than current start (${start}).`);
            break;
        }
        if (!fresh.length) {
            console.warn(`Stop because start=${start} returned no new books. This usually means Douban returned a duplicate or abnormal page.`);
            break;
        }

        start = nextStart;
        await sleep(WAIT_MS);
    }

    books.length = Math.min(books.length, MAX_BOOKS);
    const mergedBooks = appendExistingTail(books, existingBooks);
    await writeBooks(mergedBooks);
    console.log(`Done. Wrote ${mergedBooks.length} books to ${OUTPUT}${reused ? ` (${reused} reused)` : ""}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
