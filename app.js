/* Page wiring: CRT terminal I/O + pre-game boot flow (campaign/handle/archetype),
   then hands input to the NEON engine. */
(function () {
"use strict";
var out = document.getElementById("output");
var input = document.getElementById("cmd");

// ---- terminal interface the engine writes through
function line(text, cls) {
  var div = document.createElement("div");
  div.className = "line";
  (cls || "").split(/\s+/).forEach(function (c) { if (c) div.classList.add(c); });
  div.textContent = text == null ? "" : String(text);
  out.appendChild(div);
  scroll();
}
function image(url, alt) {
  var img = document.createElement("img");
  img.className = "scene"; img.src = url; img.alt = alt || "";
  img.onerror = function () { img.remove(); };
  out.appendChild(img); scroll();
}
function clearScreen() { out.innerHTML = ""; }
function scroll() { out.scrollTop = out.scrollHeight; }
NEON.setTerminal({ print: line, image: image, clear: clearScreen });

// ---- boot state machine (before the engine takes over)
var phase = "loading";
var pending = { name: null, campaign: null };
var INDEX = null, RULES = null;

function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }

function boot() {
  Promise.all([getJSON("data/index.json"), getJSON("data/rules.json")]).then(function (res) {
    INDEX = res[0]; RULES = res[1];
    NEON.setRules(RULES);
    title();
    showCampaigns();
  }).catch(function (e) {
    line("Failed to load game data: " + e.message, "rd");
    line("If you opened this file directly, run it from a web server (or the hosted link).", "grey");
  });
}

function title() {
  line("", "");
  line("  N E O N   S P R A W L", "mg b");
  line("  a sci-fi MUD of chrome, mana, and bad debts", "grey");
}

function showCampaigns() {
  phase = "campaign";
  line("", ""); line("Choose your campaign:", "ye b"); line("", "");
  INDEX.forEach(function (c, i) {
    line("  [" + (i + 1) + "] " + c.title, "wh b");
    if (c.subtitle) line("      " + c.subtitle, "mg");
    if (c.tagline) line("      " + c.tagline, "grey");
  });
}

function showMenu() {
  phase = "menu";
  line("", ""); line("  [1] New game     [2] Load game", "ye");
}

function showArchetypes() {
  phase = "archetype";
  line("", ""); line("Choose your archetype:", "ye b"); line("", "");
  NEON.archetypeList().forEach(function (k, i) {
    line("  [" + (i + 1) + "] " + title2(k), "wh b");
    line("      " + RULES.archetypes[k].blurb, "grey");
  });
}
function title2(s) { return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }

function showLoad() {
  var slots = NEON.listSaves();
  if (!slots.length) { line("  No saves for this campaign yet.", "ye"); showMenu(); return; }
  phase = "load";
  line("", ""); line("  Saved games:", "ye");
  slots.forEach(function (s, i) { line("   [" + (i + 1) + "] " + s, "wh"); });
  line("  (type a number, or 'x' to go back)", "grey");
}

// ---- input handling
function handle(raw) {
  var t = raw.trim();
  if (phase === "campaign") {
    var n = parseInt(t, 10);
    if (!(n >= 1 && n <= INDEX.length)) { line("Pick a number.", "rd"); return; }
    var c = INDEX[n - 1];
    line("\n  Loading: " + c.title, "cy");
    getJSON("data/" + c.id + ".json").then(function (data) {
      NEON.startCampaign(data); pending.campaign = c.id; showMenu();
    }).catch(function (e) { line("Failed to load campaign.", "rd"); });
    return;
  }
  if (phase === "menu") {
    if (t === "2") { showLoad(); return; }
    line("", ""); line("Runner handle:", "mg"); phase = "handle"; return;
  }
  if (phase === "handle") {
    if (!t) return; pending.name = t; showArchetypes(); return;
  }
  if (phase === "archetype") {
    var keys = NEON.archetypeList(), k = null, n2 = parseInt(t, 10);
    if (n2 >= 1 && n2 <= keys.length) k = keys[n2 - 1];
    else k = keys.find(function (x) { return t && x.indexOf(t.toLowerCase()) >= 0; });
    if (!k) { line("Pick a number.", "rd"); return; }
    NEON.newGame(pending.name, k);
    NEON.prologue();
    NEON.describeRoom();
    phase = "play";
    return;
  }
  if (phase === "load") {
    if (t.toLowerCase() === "x") { showMenu(); return; }
    var slots = NEON.listSaves(), idx = parseInt(t, 10);
    var slot = (idx >= 1 && idx <= slots.length) ? slots[idx - 1] : (slots.indexOf(t) >= 0 ? t : null);
    if (!slot) { line("No such save.", "rd"); return; }
    NEON.loadGame(slot); phase = "play"; return;
  }
  if (phase === "play") {
    NEON.submit(raw);
    var m = NEON.mode();
    if (m === "dead") { line("\n  (Reload the page or use the Load menu to try again.)", "grey"); }
    if (m === "ending") { line("\n  (Reload the page to play again.)", "grey"); }
    return;
  }
}

input.addEventListener("keydown", function (e) {
  if (e.key !== "Enter") return;
  var raw = input.value;
  input.value = "";
  if (phase !== "loading") line("> " + raw, "echo");
  try { handle(raw); } catch (err) { line("(engine error: " + err.message + ")", "rd"); }
});
document.getElementById("crt").addEventListener("click", function () { input.focus(); });
input.focus();
boot();
})();
