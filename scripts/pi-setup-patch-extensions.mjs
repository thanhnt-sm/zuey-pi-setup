#!/usr/bin/env node
/**
 * pi-setup-patch-extensions.mjs — vá các lỗi "stale extension ctx" trong package
 * bên thứ ba đang cài, vì pi coi MỌI truy cập vào ctx cũ là lỗi fatal và điều đó
 * GIẾT tiến trình pi (in stack trace ra shell) ở lần `/reload` kế tiếp.
 *
 * Cơ chế chung: `/reload`, `newSession()`, `fork()`, `switchSession()` invalidate
 * runner cũ; extension nào giữ `ctx` trong closure của một hàm chạy lại sau đó
 * (render của footer/widget, factory, callback hoãn bằng microtask) sẽ ném:
 *
 *   Error: This extension ctx is stale after session replacement or reload.
 *
 * Hai bản vá đang có:
 *
 *   pi-footer  — `render()` gọi `collectStatuslineData(ctx, …)` → `ctx.getContextUsage()`.
 *                Vá: bọc trong try/catch, trả `[]` cho frame cũ (footer được áp lại
 *                bằng ctx mới ở `session_start` kế tiếp).
 *   pi-goal-x  — widget factory của goal truyền cho host hai getter chạy ở MỖI frame
 *                (`getSettings` → `loadGoalSettings(ctx.cwd)`, `getLedgerEvents` →
 *                `goalActivityEvents(ctx, …)`). Vá: chụp `cwd` (chuỗi thuần) lúc đăng ký
 *                widget rồi dùng nó trong getter → đường render không còn chạm ctx.
 *
 * Vì sao cần script này trong repo: bản vá nằm trong `node_modules` nên
 * `pi update <package>` / cài lại SẼ ghi đè. Chạy lại script sau mỗi lần update.
 *
 * Dùng:
 *   node scripts/pi-setup-patch-extensions.mjs            # vá tất cả (idempotent)
 *   node scripts/pi-setup-patch-extensions.mjs --check    # chỉ kiểm tra, không ghi
 *   node scripts/pi-setup-patch-extensions.mjs --help
 *
 * Exit code: 0 = tất cả đã vá (hoặc vừa vá xong) · 1 = còn bản chưa vá khi chạy
 * `--check` (hoặc ghi xong mà không thấy guard → tự khôi phục từ backup) ·
 * 2 = lỗi môi trường (không thấy package, code đã đổi cấu trúc nên anchor không khớp).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

const say = (line = "") => process.stdout.write(`${line}\n`);
const complain = (line = "") => process.stderr.write(`${line}\n`);

// stripTypeScriptTypes (parser TS của Node) còn experimental nên mỗi lần gọi in một
// ExperimentalWarning; chặn đúng cảnh báo đó để output của script vẫn đọc được.
const emitWarning = process.emit;
process.emit = function (name, data, ...rest) {
	if (name === "warning" && data?.name === "ExperimentalWarning" && /stripTypeScriptTypes/i.test(String(data?.message))) return false;
	return emitWarning.call(process, name, data, ...rest);
};

/** pi cài package vào cây npm riêng của config dir. */
function agentDir() {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

function packageFile(relative) {
	return path.join(agentDir(), "npm", "node_modules", relative);
}

/** Các dòng của `source`, giữ nguyên ký tự xuống dòng và thứ tự. */
function splitLines(source) {
	return source.split("\n");
}

function indentOf(line) {
	return line.slice(0, line.length - line.trimStart().length);
}

/**
 * Thay mọi dòng có nội dung (đã trim) khớp `from` bằng `indent + to`, và yêu cầu
 * đúng `count` lần khớp — lệch nghĩa là upstream đã đổi code, phải xem lại tay.
 */
function replaceLines(lines, from, to, count, label) {
	let seen = 0;
	const out = lines.map((line) => {
		if (line.trim() !== from) return line;
		seen += 1;
		return `${indentOf(line)}${to}`;
	});
	if (seen !== count) {
		throw new Error(`${label}: khớp ${seen} lần, cần đúng ${count} lần — bản cài đã đổi cấu trúc, mở file xem lại trước khi vá.`);
	}
	return out;
}

const PI_FOOTER_ANCHOR = [
	"        render(width: number): string[] {",
	"          const data = collectStatuslineData(ctx, pi, footerData, eventWidgets.values, {",
	"            config,",
	"            requestRender: () => tui.requestRender(),",
	"            textVerbosity: liveTextVerbosity,",
	"          });",
].join("\n");

const PI_FOOTER_REPLACEMENT = [
	"        render(width: number): string[] {",
	"          let data: StatuslineData;",
	"          try {",
	"            data = collectStatuslineData(ctx, pi, footerData, eventWidgets.values, {",
	"              config,",
	"              requestRender: () => tui.requestRender(),",
	"              textVerbosity: liveTextVerbosity,",
	"            });",
	"          } catch {",
	"            // ctx is invalidated by ctx.reload()/newSession(), and pi treats any use of an",
	"            // invalidated ctx as fatal. The next session_start re-applies this footer with a",
	"            // fresh ctx, so skip this frame rather than throwing out of render.",
	"            return [];",
	"          }",
].join("\n");

const GOAL_WIDGET_MARK = "const goalCwd = ctx.cwd;";

const PATCHES = [
	{
		id: "pi-footer",
		package: "pi-footer",
		file: path.join("pi-footer", "src", "index.ts"),
		summary: "footer render đọc ctx.getContextUsage() sau /reload",
		isPatched(source) {
			return source.includes("            return [];\n          }\n          const lines = renderStatuslines(widgetStore, data, width, {");
		},
		apply(source) {
			const matches = source.split(PI_FOOTER_ANCHOR).length - 1;
			if (matches !== 1) {
				throw new Error(`pi-footer: khớp anchor ${matches} lần, cần đúng 1 — hàm render đã đổi cấu trúc.`);
			}
			return source.replace(PI_FOOTER_ANCHOR, PI_FOOTER_REPLACEMENT);
		},
	},
	{
		id: "goal-x",
		package: "pi-goal-x",
		file: path.join("pi-goal-x", "extensions", "goal-state.ts"),
		summary: "widget goal gọi getSettings/getLedgerEvents với ctx ở mỗi frame render",
		isPatched(source) {
			// Negative checks phải khoanh đúng hai getter của widget: `loadGoalSettings(ctx.cwd)` còn
			// xuất hiện ở các handler khác (ví dụ `loadGoalSettings(ctx.cwd).hideUnfocusedBanner`),
			// những chỗ đó chạy trong handler chứ không phải trong đường render nên giữ nguyên.
			const captures = source.split(GOAL_WIDGET_MARK).length - 1;
			return (
				captures === 2 &&
				source.includes("getSettings: () => loadGoalSettings(goalCwd),") &&
				source.includes("goalActivityEvents({ cwd: goalCwd }, state.goal.id)") &&
				!source.includes("getSettings: () => loadGoalSettings(ctx.cwd),") &&
				!source.includes("goalActivityEvents(ctx, state.goal.id)")
			);
		},
		apply(source) {
			let lines = splitLines(source);
			lines = replaceLines(
				lines,
				"getSettings: () => loadGoalSettings(ctx.cwd),",
				"getSettings: () => loadGoalSettings(goalCwd),",
				2,
				"goal-x getSettings",
			);
			lines = replaceLines(
				lines,
				"getLedgerEvents: () => state.goal ? goalActivityEvents(ctx, state.goal.id) : [],",
				"getLedgerEvents: () => state.goal ? goalActivityEvents({ cwd: goalCwd }, state.goal.id) : [],",
				2,
				"goal-x getLedgerEvents",
			);
			// `cwd` là chuỗi thuần, chụp ngay lúc đăng ký widget (ctx còn hợp lệ) → getter
			// không còn chạm ctx nữa. Trim vẫn giữ nguyên hành vi: cùng cwd, cùng file settings.
			let inserted = 0;
			const withCapture = [];
			for (let i = 0; i < lines.length; i += 1) {
				const line = lines[i];
				const next = lines[i + 1];
				if (line.trim() === "ctx.ui.setWidget(" && next && next.trim() === "GOAL_WIDGET_KEY,") {
					const indent = indentOf(line);
					withCapture.push(`${indent}// The widget getters below run inside pi's render loop, and pi invalidates an extension's ctx`);
					withCapture.push(`${indent}// on /reload or session replacement: touching ctx there throws and pi treats it as fatal. \`cwd\` is`);
					withCapture.push(`${indent}// a plain string, so capture it here (while the ctx is valid) and let the getters read that.`);
					withCapture.push(`${indent}${GOAL_WIDGET_MARK}`);
					inserted += 1;
				}
				withCapture.push(line);
			}
			if (inserted !== 2) {
				throw new Error(`goal-x: thấy ${inserted} chỗ đăng ký widget (cần 2) — bản cài đã đổi cấu trúc.`);
			}
			return withCapture.join("\n");
		},
	},
];

const checkOnly = process.argv.includes("--check");
for (const arg of process.argv.slice(2)) {
	if (arg === "--check") continue;
	if (arg === "--help" || arg === "-h") {
		say("Dùng: node scripts/pi-setup-patch-extensions.mjs [--check]");
		process.exit(0);
	}
	complain(`tham số lạ: ${arg} (chỉ có --check)`);
	process.exit(2);
}

const results = [];
let environmentError = false;

for (const patch of PATCHES) {
	const file = packageFile(patch.file);
	if (!fs.existsSync(file)) {
		complain(`[${patch.id}] không thấy ${file}`);
		complain(`          → máy này chưa cài npm:${patch.package}, hoặc pi đổi layout thư mục npm/.`);
		environmentError = true;
		continue;
	}

	const source = fs.readFileSync(file, "utf8");
	if (patch.isPatched(source)) {
		say(`[${patch.id}] đã vá trước đó — ${patch.summary}`);
		results.push({ id: patch.id, status: "already" });
		continue;
	}

	if (checkOnly) {
		complain(`[${patch.id}] CHƯA VÁ — ${patch.summary}`);
		results.push({ id: patch.id, status: "missing" });
		continue;
	}

	let patched;
	try {
		patched = patch.apply(source);
	} catch (error) {
		complain(`[${patch.id}] ${error.message}`);
		environmentError = true;
		continue;
	}

	const backup = `${file}.bak-pi-setup-patch`;
	if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);

	const tmp = `${file}.tmp-pi-setup-patch-${process.pid}`;
	fs.writeFileSync(tmp, patched);
	fs.renameSync(tmp, file);

	// Tự kiểm tra: file phải parse được, phải mang guard, và guard phải thật sự có tác dụng.
	try {
		stripTypeScriptTypes(fs.readFileSync(file, "utf8"), { mode: "strip" });
	} catch (error) {
		fs.copyFileSync(backup, file);
		complain(`[${patch.id}] bản vá không parse được (${error.message}) → đã khôi phục file gốc từ backup.`);
		results.push({ id: patch.id, status: "reverted" });
		continue;
	}
	if (!patch.isPatched(fs.readFileSync(file, "utf8"))) {
		fs.copyFileSync(backup, file);
		complain(`[${patch.id}] ghi xong nhưng không thấy guard → đã khôi phục file gốc từ backup.`);
		results.push({ id: patch.id, status: "reverted" });
		continue;
	}

	say(`[${patch.id}] ĐÃ VÁ — ${patch.summary}`);
	say(`          ${file}`);
	results.push({ id: patch.id, status: "patched" });
}

const missing = results.filter((r) => r.status === "missing").length;
const reverted = results.filter((r) => r.status === "reverted").length;

if (!checkOnly && !environmentError && !reverted) {
	say("");
	say("→ khởi động lại pi (hoặc /reload) để dùng bản vá; chạy lại script này sau MỖI lần `pi update` package.");
}

if (environmentError || reverted) process.exit(2);
if (checkOnly && missing) process.exit(1);
process.exit(0);
