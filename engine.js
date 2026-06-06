/* NEON SPRAWL - browser engine (port of engine.py).
   Mode-driven state machine. All output goes through a terminal interface (T)
   so it runs in the browser and is testable headless in node. */
(function (root) {
"use strict";

// ----- terminal interface (overridden by the page; console fallback for node)
var T = {
  print: function (s) { if (typeof console !== "undefined") console.log(s == null ? "" : String(s)); },
  image: function () {},
  clear: function () {},
};

// ----- loaded data
var RULES = null;            // {archetypes, abilities, attr_names, cyber_slots, attr_cap, skill_cap}
var DATA = null;             // {manifest, rooms, items, enemies, npcs, quests}
function ROOMS() { return DATA.rooms; }
function ITEMS() { return DATA.items; }
function ENEMIES() { return DATA.enemies; }
function NPCS() { return DATA.npcs; }
function QUESTS() { return DATA.quests; }

// ----- game state
var G = null;   // {p, mode, fx, combat, combatOnWin, ...}

// ============================================================ helpers ======
function p(text, cls) { T.print(text == null ? "" : text, cls || ""); }
function blank() { T.print("", ""); }
function rule(ch, cls) { T.print((ch || "-").repeat(84), cls || "grey"); }
function banner(title, cls) {
  rule("=", cls || "cy");
  T.print("  " + title, (cls || "cy") + " b");
  rule("=", cls || "cy");
}
function rint(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function roll(pool) {
  pool = Math.max(0, Math.floor(pool));
  var hits = 0;
  for (var i = 0; i < pool; i++) if (rint(1, 6) >= 5) hits++;
  return hits;
}

// ----- player-derived stats
function attr(pl, name) {
  var base = (pl.attrs[name] || 0);
  for (var i = 0; i < pl.cyberware.length; i++) {
    var it = ITEMS()[pl.cyberware[i]];
    if (it && it.bonus && it.bonus[name]) base += it.bonus[name];
  }
  return base;
}
function maxHp(pl) { return 20 + attr(pl, "body") * 4; }
function armorVal(pl) {
  if (!pl.armor) return 0;
  var it = ITEMS()[pl.armor];
  return (it && it.armor) || 0;
}

// ----- flags / items
function hasFlag(f) { return G.p.flags.indexOf(f) >= 0; }
function setFlag(f) { if (G.p.flags.indexOf(f) < 0) G.p.flags.push(f); }
function itemName(id) { var it = ITEMS()[id]; return (it && it.name) || id; }
function hasItem(id) {
  return G.p.inventory.indexOf(id) >= 0 || G.p.weapon === id || G.p.armor === id;
}
function addItem(id) { G.p.inventory.push(id); p("   + " + itemName(id), "gn"); }
function removeItem(id) {
  var i = G.p.inventory.indexOf(id);
  if (i >= 0) G.p.inventory.splice(i, 1);
}
function room() { return ROOMS()[G.p.location]; }

// ----- gates
function gatesPass(o) {
  if (o.if_flag && !hasFlag(o.if_flag)) return false;
  if (o.if_not_flag && hasFlag(o.if_not_flag)) return false;
  if (o.if_item && !hasItem(o.if_item)) return false;
  if (o.require_item && !hasItem(o.require_item)) return false;
  return true;
}
function actionUid(rid, aid) { return rid + ":" + aid; }

// ============================================================ rooms ========
function imageUrl(fname) {
  if (!fname) return null;
  return "images/" + G.p.campaign + "/" + fname;
}

function describeRoom(full) {
  if (full === undefined) full = true;
  var r = room(), rid = G.p.location;
  var first = G.p.visited.indexOf(rid) < 0;
  if (first) G.p.visited.push(rid);
  blank();
  if (r.image) T.image(imageUrl(r.image), r.name);
  banner(r.name.toUpperCase() + "   [" + r.district + "]", "cy");
  blank();
  if (first && r.first_enter) { p(r.first_enter, "ye"); blank(); }
  p(r.desc, "wh");
  if (full) { showExits(); showOptions(); }
}

function showExits() {
  var r = room(), outs = [];
  for (var d in r.exits) {
    var dest = r.exits[d];
    if (dest && typeof dest === "object") {
      var ok = dest.require_flag ? hasFlag(dest.require_flag) : true;
      outs.push(ok ? d : (d + "(locked)"));
    } else outs.push(d);
  }
  if (outs.length) { blank(); p("  Exits: " + outs.join(", "), "cy"); }
}

function visibleActions() {
  var r = room(), out = [];
  (r.actions || []).forEach(function (a) {
    if (a.once && G.p.used.indexOf(actionUid(G.p.location, a.id)) >= 0) return;
    if (!gatesPass(a)) return;
    out.push(a);
  });
  return out;
}

function numberedTargets() {
  var r = room(), seq = [];
  visibleActions().forEach(function (a) { seq.push({ kind: "action", payload: a }); });
  (r.npcs || []).forEach(function (n) { seq.push({ kind: "npc", payload: n }); });
  if (r.shop) seq.push({ kind: "shop", payload: r.shop });
  return seq;
}

function showOptions() {
  var r = room(), seq = numberedTargets(), n = 1;
  if (seq.length) { blank(); p("  What do you do?", "ye b"); }
  seq.forEach(function (t) {
    var label;
    if (t.kind === "action") label = t.payload.label;
    else if (t.kind === "npc") label = "Talk to " + NPCS()[t.payload].name;
    else label = "Browse " + t.payload.name;
    p("   [" + n + "] " + label, "wh"); n++;
  });
  p("   (or: go <dir>, look, stats, inv, equip, use, quests, map, help)", "grey");
}

// ============================================================ movement =====
var ALIAS = { n: "north", s: "south", e: "east", w: "west", u: "up", d: "down" };
function move(dir) {
  var r = room(), exits = r.exits || {};
  dir = ALIAS[dir] || dir;
  if (!(dir in exits)) { p("You can't go that way.", "rd"); return; }
  var dest = exits[dir];
  if (dest && typeof dest === "object") {
    if (dest.require_flag && !hasFlag(dest.require_flag)) { p(dest.locked_msg || "That way is sealed.", "rd"); return; }
    if (dest.require_item && !hasItem(dest.require_item)) { p(dest.locked_msg || "That way is sealed.", "rd"); return; }
    G.p.location = dest.room;
  } else G.p.location = dest;
  if (maybeEncounter()) return;     // encounter starts combat (pauses)
  describeRoom();
}

function maybeEncounter() {
  var r = room(), enc = r.encounter;
  if (!enc) return false;
  if (Math.random() < (enc.chance || 0)) {
    var eid = choice(enc.enemies);
    blank(); p("Ambush! A " + ENEMIES()[eid].name + " steps out of the shadows.", "rd b");
    G.pendingDescribe = true;       // after this combat, describe the room
    startCombat({ enemy: eid });
    return true;
  }
  return false;
}

// ============================================================ effects ======
function runEffects(effects) {
  G.fx = (effects || []).slice();
  pumpEffects();
}
function pumpEffects() {
  while (G.fx.length) {
    var e = G.fx.shift();
    if (e.type === "combat") { startCombat(e); return; }   // pause
    applyEffect(e);
    if (G.mode === "ending") { G.fx = []; return; }
  }
  if (G.mode === "explore") showOptions();
}
function applyEffect(e) {
  switch (e.type) {
    case "text": blank(); p(e.msg, "wh"); break;
    case "give_item": addItem(e.id); break;
    case "give_items": e.ids.forEach(addItem); break;
    case "take_item": removeItem(e.id); p("   - " + itemName(e.id), "ye"); break;
    case "credits": G.p.creds += e.amount; p("   + ¥" + e.amount + " creds", "gn"); break;
    case "gamble": gamble(e.amount || 100); break;
    case "karma": G.p.karma += e.amount; p("   + " + e.amount + " karma", "mg"); break;
    case "heal": heal(e.amount === "full" ? maxHp(G.p) : e.amount); break;
    case "edge": G.p.edge = G.p.max_edge; p("   Edge restored.", "cy"); break;
    case "flag": setFlag(e.id); break;
    case "goto": G.p.location = e.room; describeRoom(); break;
    case "quest": questEffect(e); break;
    case "ending": doEnding(e); break;
  }
}
function questEffect(e) {
  var q = QUESTS()[e.id] || {};
  if (e.action === "start") {
    G.p.quests[e.id] = "active";
    blank(); p("   * NEW OBJECTIVE: " + (q.name || e.id), "ye b");
  } else if (e.action === "complete") {
    G.p.quests[e.id] = "done";
    blank(); p("   * OBJECTIVE COMPLETE: " + (q.name || e.id), "gn b");
    if (e.credits) { G.p.creds += e.credits; p("   + ¥" + e.credits + " creds", "gn"); }
    if (e.karma) { G.p.karma += e.karma; p("   + " + e.karma + " karma", "mg"); }
  }
}
function heal(amt) {
  var mh = maxHp(G.p), before = G.p.hp;
  G.p.hp = Math.min(mh, G.p.hp + amt);
  p("   Healed " + (G.p.hp - before) + " HP  (" + G.p.hp + "/" + mh + ").", "gn");
}
function gamble(stake) {
  var pl = G.p;
  if (pl.creds < stake) { p("   You can't cover the ¥" + stake + " table minimum.", "rd"); return; }
  pl.creds -= stake;
  var r = Math.random();
  if (r < 0.375) { pl.creds += stake * 2; p("   The wheel loves you! You take ¥" + (stake * 2) + " (net +¥" + stake + ").", "gn"); }
  else if (r < 0.405) { pl.creds += stake * 5; p("   JACKPOT! The table pays ¥" + (stake * 5) + "!", "ye b"); }
  else p("   The house takes your ¥" + stake + ". Of course it does.", "rd");
  p("   Creds: ¥" + pl.creds, "grey");
}
function doEnding(e) {
  blank(); rule("=", "mg"); p(e.msg, "wh"); rule("=", "mg");
  p("\n  Thank you for playing NEON SPRAWL.\n", "cy b");
  G.mode = "ending";
}

// ============================================================ actions ======
function doAction(a) {
  if (!gatesPass(a)) { p("You can't do that right now.", "rd"); return; }
  if (a.once) G.p.used.push(actionUid(G.p.location, a.id));
  if (a.safehouse) { G.p.hp = maxHp(G.p); G.p.edge = G.p.max_edge; }
  if (a.text) { blank(); p(a.text, "wh"); }
  runEffects(a.effects);
  if (a.safehouse && G.mode === "explore") {
    p("   HP " + G.p.hp + "/" + maxHp(G.p) + "   Edge " + G.p.edge + "/" + G.p.max_edge, "gn");
    saveGame("autosave", true);
    p("   (Auto-saved. Use the Load menu or 'load autosave' to return here.)", "grey");
  }
}

// ============================================================ npcs =========
function talk(npcId) {
  var npc = NPCS()[npcId];
  blank(); banner(npc.name, "mg"); p(npc.desc, "dim wh");
  var chosen = null;
  for (var i = 0; i < npc.stages.length; i++) { if (gatesPass(npc.stages[i])) { chosen = npc.stages[i]; break; } }
  if (!chosen) chosen = npc.stages[npc.stages.length - 1];
  blank(); p(chosen.text, "wh");
  runEffects(chosen.effects);
}

// ============================================================ shop =========
function itemTag(it) {
  if (it.type === "weapon") return "(wpn DV" + it.dv + " " + it.reach + ")";
  if (it.type === "armor") return "(armor " + it.armor + ")";
  if (it.type === "cyberware") {
    var b = []; for (var k in it.bonus) b.push("+" + it.bonus[k] + " " + k);
    return "(cyber " + b.join(", ") + ")";
  }
  if (it.type === "consumable") return "(" + it.effect + " " + it.amount + ")";
  return "";
}
function discount() { return G.p.akey === "face" ? 0.85 : 1.0; }
function openShop(shop) {
  G.shop = shop; G.mode = "shop"; showShop();
}
function showShop() {
  var shop = G.shop, disc = discount();
  blank(); banner(shop.name, "ye"); p(shop.greeting, "dim wh");
  p("\n  Your creds: ¥" + G.p.creds + (disc < 1 ? "   (Face discount applied)" : ""), "gn"); blank();
  shop.sells.forEach(function (iid, i) {
    var it = ITEMS()[iid], price = Math.floor(it.value * disc);
    p("   [" + (i + 1) + "] " + pad(it.name, 28) + " ¥" + pad(String(price), 6) + " " + itemTag(it), "wh");
  });
  p("   [s] Sell    [x] Leave", "grey");
}
function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
function handleShop(c) {
  var shop = G.shop, disc = discount();
  if (c === "x" || c === "leave" || c === "exit" || c === "") { G.mode = "explore"; p("You step back into the world.", "grey"); blank(); describeRoom(); return; }
  if (c === "s") { showSell(); return; }
  var n = parseInt(c, 10);
  if (!isNaN(n) && n >= 1 && n <= shop.sells.length) {
    var iid = shop.sells[n - 1], price = Math.floor(ITEMS()[iid].value * disc);
    if (G.p.creds < price) { p("Not enough creds, chummer.", "rd"); return; }
    G.p.creds -= price; G.p.inventory.push(iid);
    p("Bought " + ITEMS()[iid].name + " for ¥" + price + ".", "gn");
  } else p("?", "rd");
}
function showSell() {
  var sellable = G.p.inventory.filter(function (i) { return (ITEMS()[i] || {}).value > 0; });
  if (!sellable.length) { p("Nothing worth selling.", "grey"); return; }
  G.sellList = sellable;
  blank();
  sellable.forEach(function (iid, i) { p("   [" + (i + 1) + "] " + pad(ITEMS()[iid].name, 28) + " sell ¥" + Math.floor(ITEMS()[iid].value / 2), "wh"); });
  p("   [x] back", "grey");
  G.mode = "sell";
}
function handleSell(c) {
  if (c === "x" || c === "") { G.mode = "shop"; showShop(); return; }
  var n = parseInt(c, 10), list = G.sellList || [];
  if (!isNaN(n) && n >= 1 && n <= list.length) {
    var iid = list[n - 1], gain = Math.floor(ITEMS()[iid].value / 2);
    var idx = G.p.inventory.indexOf(iid);
    if (idx >= 0) G.p.inventory.splice(idx, 1);
    G.p.creds += gain; p("Sold " + ITEMS()[iid].name + " for ¥" + gain + ".", "gn");
    showSell();
  } else p("?", "rd");
}

// ============================================================ combat =======
function poolFor(weaponId, extra) {
  var w = ITEMS()[weaponId];
  return { pool: attr(G.p, w.attr || "agility") + (G.p.skills[w.skill || "firearms"] || 0) + (extra || 0), dv: w.dv, name: w.name };
}
function startCombat(e) {
  var en = JSON.parse(JSON.stringify(ENEMIES()[e.enemy]));
  en.cur_hp = en.hp;
  G.combat = { e: en, buffs: { atk: 0, def: 0, edef: 0 }, stunned: false, round: 0 };
  G.combatOnWin = e.on_win || [];
  blank(); rule("~", "rd"); p("  COMBAT:  " + G.p.name + "  vs  " + en.name, "rd b"); rule("~", "rd");
  if (en.portrait) T.image(imageUrl(en.portrait), en.name);
  if (e.intro) { blank(); p(e.intro, "rd"); }
  p(en.desc, "dim wh");
  G.mode = "combat";
  combatPrompt();
}
function combatPrompt() {
  var c = G.combat, en = c.e;
  blank();
  p("  -- Round " + (c.round + 1) + " --   You: " + G.p.hp + "/" + maxHp(G.p) + " HP, " + G.p.edge + " Edge   |   " + en.name + ": " + en.cur_hp + "/" + en.hp + " HP", "ye");
  p("   [1] Attack with weapon", "wh");
  p("   [2] Use ability", "wh");
  p("   [3] Use item", "wh");
  p("   [4] Aim (next attack +2 dice)", "wh");
  p("   [5] Flee", "wh");
}
function handleCombat(c) {
  var cb = G.combat, en = cb.e;
  cb.round++;
  var acted = true;
  if (c === "1" || c === "attack" || c === "a" || c === "") playerAttack();
  else if (c === "2" || c === "ability") { acted = openAbility(); if (!acted) return; }
  else if (c === "3" || c === "item" || c === "use") { acted = openCombatItem(); if (!acted) return; }
  else if (c === "4" || c === "aim") { cb.buffs.atk += 2; p("   You steady your aim. (+2 dice next attack)", "cy"); }
  else if (c === "5" || c === "flee" || c === "run") {
    if (tryFlee()) { endCombatFlee(); return; }
    else p("   You can't break away!", "rd");
  } else { p("   Hesitation costs you the initiative.", "grey"); }

  if (en.cur_hp <= 0) { endCombatWin(); return; }
  enemyTurn();
  if (G.p.hp <= 0) { endCombatDeath(); return; }
  combatPrompt();
}
function playerAttack(override) {
  var cb = G.combat, en = cb.e, pool, dv, pierce, wname;
  if (override) { pool = override.pool; dv = override.dv; pierce = override.pierce; wname = override.name; }
  else { var pf = poolFor(G.p.weapon, cb.buffs.atk); pool = pf.pool; dv = pf.dv; pierce = false; wname = pf.name; }
  cb.buffs.atk = 0;
  var hits = roll(pool);
  var edef = Math.max(0, en.defense - cb.buffs.edef);
  var dhits = roll(edef);
  var net = hits - dhits;
  if (net <= 0) { p("   " + wname + ": " + hits + " hits vs " + dhits + " dodge. Miss!", "grey"); return; }
  var soak = roll(pierce ? Math.floor(en.soak / 2) : en.soak);
  var dmg = Math.max(1, dv + net - soak);
  en.cur_hp -= dmg;
  p("   " + wname + ": " + hits + " hits vs " + dhits + " dodge (net " + net + "), DV" + dv + " - " + soak + " soak = " + dmg + " damage!", "gn");
}
function openAbility() {
  var abis = G.p.abilities;
  if (!abis.length) { p("   You have no special abilities.", "grey"); return false; }
  blank();
  abis.forEach(function (aid, i) { var ab = RULES.abilities[aid]; p("   [" + (i + 1) + "] " + ab.name + "  (Edge " + ab.cost + ")  - " + ab.desc, "wh"); });
  p("   [x] back", "grey");
  G.mode = "combat_ability";
  return false; // turn not spent yet
}
function handleAbility(c) {
  var abis = G.p.abilities;
  if (c === "x" || c === "") { G.mode = "combat"; combatPrompt(); return; }
  var n = parseInt(c, 10);
  if (isNaN(n) || n < 1 || n > abis.length) { p("?", "rd"); return; }
  var aid = abis[n - 1], ab = RULES.abilities[aid];
  if (G.p.edge < ab.cost) { p("   Not enough Edge.", "rd"); return; }
  G.mode = "combat";
  G.p.edge -= ab.cost;
  applyAbility(ab);
  // ability consumes the turn -> resolve enemy
  var en = G.combat.e;
  if (en.cur_hp <= 0) { endCombatWin(); return; }
  enemyTurn();
  if (G.p.hp <= 0) { endCombatDeath(); return; }
  combatPrompt();
}
function applyAbility(ab) {
  var cb = G.combat, en = cb.e, pl = G.p;
  switch (ab.kind) {
    case "buff_atk": cb.buffs.atk += ab.dice; p("   " + ab.name + "! Your strikes sharpen. (+" + ab.dice + " dice)", "cy"); break;
    case "debuff_def": cb.buffs.edef += ab.value; p("   " + ab.name + "! The target's defenses buckle.", "cy"); break;
    case "debuff_atk": en.attack = Math.max(0, en.attack - ab.value); p("   " + ab.name + "! The target is pinned down.", "cy"); break;
    case "heal": heal(pl.magic * ab.magic_mult); break;
    case "heal_buff": heal(ab.heal); cb.buffs.def += ab.value; p("   Fortune favors you. (+" + ab.value + " defense dice)", "cy"); break;
    case "intimidate":
      var ch = 0.3 + attr(pl, "charisma") * 0.06;
      if (en.cur_hp < en.hp * 0.5) ch += 0.25;
      if (Math.random() < ch) { p("   " + en.name + " breaks and flees from your fury!", "gn"); en.cur_hp = 0; }
      else p("   " + en.name + " snarls but holds its ground.", "ye");
      break;
    case "attack":
      if (ab.magic) playerAttack({ pool: attr(pl, "willpower") + pl.magic, dv: pl.magic, pierce: true, name: ab.name });
      else if (ab.attr) playerAttack({ pool: attr(pl, ab.attr) + (pl.skills[ab.skill] || 0) + (ab.dice || 0), dv: ab.dv, pierce: false, name: ab.name });
      else { var pf = poolFor(pl.weapon, ab.dice || 0); playerAttack({ pool: pf.pool, dv: ab.dv, pierce: false, name: ab.name }); }
      if (ab.stun && en.cur_hp > 0 && Math.random() < 0.5) { p("   The blast rattles " + en.name + " senseless!", "mg"); cb.stunned = true; }
      break;
  }
}
function openCombatItem() {
  var cons = G.p.inventory.filter(function (i) { return (ITEMS()[i] || {}).type === "consumable"; });
  if (!cons.length) { p("   No usable items.", "grey"); return false; }
  var seen = [];
  cons.forEach(function (iid) { if (seen.indexOf(iid) < 0) seen.push(iid); });
  G.itemList = seen;
  blank();
  seen.forEach(function (iid, i) {
    var it = ITEMS()[iid], cnt = cons.filter(function (x) { return x === iid; }).length;
    p("   [" + (i + 1) + "] " + it.name + " x" + cnt + " - " + it.effect + " " + it.amount, "wh");
  });
  p("   [x] back", "grey");
  G.mode = "combat_item";
  return false;
}
function handleCombatItem(c) {
  if (c === "x" || c === "") { G.mode = "combat"; combatPrompt(); return; }
  var n = parseInt(c, 10), list = G.itemList || [];
  if (isNaN(n) || n < 1 || n > list.length) { p("?", "rd"); return; }
  applyConsumable(list[n - 1]);
  G.mode = "combat";
  var en = G.combat.e;
  if (en.cur_hp <= 0) { endCombatWin(); return; }
  enemyTurn();
  if (G.p.hp <= 0) { endCombatDeath(); return; }
  combatPrompt();
}
function applyConsumable(iid) {
  var it = ITEMS()[iid];
  if (it.effect === "heal") heal(it.amount);
  else if (it.effect === "edge") { G.p.edge = Math.min(G.p.max_edge, G.p.edge + it.amount); p("   Edge restored to " + G.p.edge + "/" + G.p.max_edge + ".", "cy"); }
  var idx = G.p.inventory.indexOf(iid);
  if (idx >= 0) G.p.inventory.splice(idx, 1);
}
function enemyTurn() {
  var cb = G.combat, en = cb.e;
  if (cb.stunned) { p("   " + en.name + " is stunned and reels, unable to act!", "mg"); cb.stunned = false; return; }
  var pool = roll(en.attack);
  var ddef = roll(attr(G.p, "reaction") + attr(G.p, "intuition") + cb.buffs.def);
  var net = pool - ddef;
  if (net <= 0) { p("   " + en.name + " attacks... " + pool + " hits vs " + ddef + " dodge. You evade!", "gn"); return; }
  var soak = roll(attr(G.p, "body") + Math.floor(armorVal(G.p) / 3));
  var dmg = Math.max(1, en.dv + net - soak);
  G.p.hp -= dmg;
  p("   " + en.name + " hits! " + pool + " vs " + ddef + " (net " + net + "), DV" + en.dv + " - " + soak + " soak = " + dmg + " damage to you!", "rd");
}
function tryFlee() {
  var mine = roll(attr(G.p, "reaction") + attr(G.p, "intuition"));
  var theirs = roll(Math.floor((G.combat.e.init || 6) / 2) + 2);
  return mine >= theirs;
}
function combatRewards() {
  var en = G.combat.e;
  blank(); rule("~", "gn"); p("  " + en.name + " is down!", "gn b");
  if (en.creds && (en.creds[0] || en.creds[1])) { var ny = rint(en.creds[0], en.creds[1]); G.p.creds += ny; p("   + ¥" + ny + " creds", "gn"); }
  if (en.karma) { G.p.karma += en.karma; p("   + " + en.karma + " karma", "mg"); }
  (en.loot || []).forEach(function (l) { if (Math.random() < l[1]) { G.p.inventory.push(l[0]); p("   + " + itemName(l[0]) + " (looted)", "gn"); } });
  rule("~", "gn");
}
function endCombatWin() {
  combatRewards();
  var onWin = G.combatOnWin || [];
  G.combat = null; G.combatOnWin = null; G.mode = "explore";
  G.fx = onWin.concat(G.fx || []);
  if (G.pendingDescribe) { G.pendingDescribe = false; pumpEffects(); describeRoom(); }
  else pumpEffects();
}
function endCombatFlee() {
  p("   You break contact and slip away into the dark.", "ye");
  G.combat = null; G.combatOnWin = null; G.fx = []; G.mode = "explore";
  if (G.pendingDescribe) { G.pendingDescribe = false; describeRoom(); }
  else showOptions();
}
function endCombatDeath() {
  blank(); rule("=", "rd"); p("  YOU FLATLINE.", "rd b");
  p("The sprawl swallows another runner. Your story ends here... unless you've got a save to fall back on.", "rd");
  rule("=", "rd");
  G.combat = null; G.mode = "dead";
}

// ============================================================ panels =======
var ATTRS = function () { return RULES.attr_names; };
function showStats() {
  var pl = G.p;
  blank(); banner(pl.name + "  --  " + title(pl.archetype), "mg");
  p("  HP " + pl.hp + "/" + maxHp(pl) + "   Edge " + pl.edge + "/" + pl.max_edge + (pl.magic ? "   Magic " + pl.magic : "") + "   Creds ¥" + pl.creds + "   Karma " + pl.karma, "gn");
  blank();
  p("  " + ATTRS().map(function (a) { return a.slice(0, 3).toUpperCase() + " " + attr(pl, a); }).join("  "), "cy");
  p("  Skills: " + Object.keys(pl.skills).map(function (k) { return k + " " + pl.skills[k]; }).join("  "), "ye");
  var w = ITEMS()[pl.weapon] || { name: pl.weapon, dv: "?", reach: "?" };
  var ar = pl.armor ? ITEMS()[pl.armor] : null;
  p("  Weapon: " + w.name + " (DV" + w.dv + " " + w.reach + ")", "wh");
  p("  Armor:  " + (ar ? ar.name : "none") + " (" + armorVal(pl) + ")", "wh");
  if (pl.cyberware.length) p("  Cyberware: " + pl.cyberware.map(function (c) { return (ITEMS()[c] || { name: c }).name; }).join(", "), "mg");
  if (pl.abilities.length) p("  Abilities: " + pl.abilities.map(function (a) { return RULES.abilities[a].name; }).join(", "), "mg");
}
function title(s) { return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); }); }
function showInv() {
  var pl = G.p; blank(); banner("INVENTORY", "ye");
  if (!pl.inventory.length) p("  (empty)", "grey");
  var counts = {}, order = [];
  pl.inventory.forEach(function (i) { if (!(i in counts)) { order.push(i); counts[i] = 0; } counts[i]++; });
  order.forEach(function (iid) {
    var it = ITEMS()[iid] || { name: iid, type: "?", desc: "" };
    p("   " + it.name + (counts[iid] > 1 ? " x" + counts[iid] : "") + "  " + itemTag(it), "wh");
    p("      " + (it.desc || ""), "grey");
  });
  p("\n  Creds: ¥" + pl.creds, "gn");
}
function showQuests() {
  blank(); banner("QUEST LOG", "ye"); var any = false;
  for (var qid in G.p.quests) {
    var st = G.p.quests[qid], q = QUESTS()[qid] || {};
    p("  " + (st === "done" ? "[x]" : "[ ]") + " " + (q.name || qid), (st === "done" ? "gn" : "wh") + " b");
    p("      " + (q.desc || ""), "grey"); any = true;
  }
  if (!any) p("  No active objectives. Talk to people. Find work.", "grey");
}
function showMap() {
  blank(); banner("KNOWN DISTRICTS", "cy");
  var dist = {};
  G.p.visited.forEach(function (rid) { var r = ROOMS()[rid]; (dist[r.district] = dist[r.district] || []).push(r.name); });
  for (var d in dist) {
    p("  " + d + ":", "ye");
    dist[d].forEach(function (rn) { var here = ROOMS()[G.p.location].name === rn ? " <- you" : ""; p("     - " + rn + here, here ? "wh" : "grey"); });
  }
}
function showHelp() {
  blank(); banner("COMMANDS", "cy");
  [["go <dir> / n,s,e,w,u,d", "Move between rooms"],
   ["<number>", "Choose a listed option"],
   ["look (l)", "Re-read the room"], ["talk <name>", "Talk to someone"],
   ["shop / buy", "Browse the local shop"], ["stats / inv / quests / map", "Your sheets"],
   ["equip <item>", "Wield a weapon / wear armor"], ["install <cyber>", "Install cyberware"],
   ["use <item>", "Use a consumable"], ["improve", "Spend karma on attributes & skills"],
   ["save / load [slot]", "Save or load (browser storage)"]
  ].forEach(function (r) { p("   " + pad(r[0], 28) + r[1], "wh"); });
  blank();
  p("  COMBAT: choose Attack, Use ability, Use item, Aim, or Flee.", "ye");
  p("  Tip: rest at a safehouse (doss / the Griffin / a bar) to restore HP & Edge.", "ye");
}

// ============================================================ equip/use ====
function findInv(arg) {
  arg = arg.toLowerCase().trim(); if (!arg) return null;
  for (var i = 0; i < G.p.inventory.length; i++) {
    var iid = G.p.inventory[i], it = ITEMS()[iid] || {};
    if (iid.toLowerCase().indexOf(arg) >= 0 || (it.name || "").toLowerCase().indexOf(arg) >= 0) return iid;
  }
  return null;
}
function cmdEquip(arg) {
  var m = findInv(arg); if (!m) { p("You don't have that.", "rd"); return; }
  var it = ITEMS()[m];
  if (it.type === "weapon") {
    var old = G.p.weapon; G.p.weapon = m; G.p.inventory.splice(G.p.inventory.indexOf(m), 1);
    if (old && old !== "fists") G.p.inventory.push(old);
    p("Equipped " + it.name + ".", "gn");
  } else if (it.type === "armor") {
    var old2 = G.p.armor; G.p.armor = m; G.p.inventory.splice(G.p.inventory.indexOf(m), 1);
    if (old2) G.p.inventory.push(old2);
    p("Equipped " + it.name + ".", "gn");
  } else p("You can't equip that.", "rd");
}
function cmdInstall(arg) {
  var m = findInv(arg);
  if (!m || (ITEMS()[m] || {}).type !== "cyberware") { p("That's not installable cyberware in your inventory.", "rd"); return; }
  var slot = ITEMS()[m].slot;
  if (slot) {
    G.p.cyberware.slice().forEach(function (ex) {
      if ((ITEMS()[ex] || {}).slot === slot) {
        G.p.cyberware.splice(G.p.cyberware.indexOf(ex), 1); G.p.inventory.push(ex);
        p("Your " + slot + " slot was occupied -- removed " + itemName(ex) + " to make room.", "ye");
      }
    });
  }
  G.p.inventory.splice(G.p.inventory.indexOf(m), 1); G.p.cyberware.push(m);
  G.p.hp = Math.min(maxHp(G.p), G.p.hp);
  var b = []; for (var k in ITEMS()[m].bonus) b.push("+" + ITEMS()[m].bonus[k] + " " + k);
  p("Installed " + ITEMS()[m].name + " (" + b.join(", ") + "). The chrome settles into you.", "mg");
}
function cmdUse(arg) {
  var m = findInv(arg); if (!m) { p("You don't have that.", "rd"); return; }
  var it = ITEMS()[m];
  if (it.type === "consumable") applyConsumable(m);
  else p("Nothing happens. (Try 'equip' or 'install' for gear.)", "grey");
}

// ----- improve (mode-driven)
function cmdImprove() {
  blank(); banner("KARMA TRAINING", "mg");
  p("  Karma available: " + G.p.karma, "gn");
  p("  Raise an attribute (cost = new rating x5, max " + RULES.attr_cap + ") or skill (x3, max " + RULES.skill_cap + ").", "grey");
  p("  Attributes: " + ATTRS().join(", "), "cy");
  p("  Skills: " + Object.keys(G.p.skills).join(", "), "ye");
  p("  (type an attribute/skill name, or 'x' to cancel)", "grey");
  G.mode = "improve";
}
function handleImprove(t) {
  t = t.toLowerCase().trim();
  if (t === "x" || t === "") { G.mode = "explore"; p("You pocket your karma for now.", "grey"); blank(); showOptions(); return; }
  var pl = G.p;
  if (t in pl.attrs) {
    if (attr_base(t) >= RULES.attr_cap) { p(title(t) + " is at the natural limit (" + RULES.attr_cap + "). Raise it with cyberware.", "rd"); return; }
    var nw = pl.attrs[t] + 1, cost = nw * 5;
    if (pl.karma < cost) { p("Need " + cost + " karma.", "rd"); return; }
    pl.karma -= cost; pl.attrs[t] = nw; if (t === "body") pl.hp = Math.min(maxHp(pl), pl.hp + 4);
    p(title(t) + " raised to " + nw + " (base). -" + cost + " karma.", "gn");
  } else if (t in pl.skills) {
    if (pl.skills[t] >= RULES.skill_cap) { p(t + " is already mastered (max " + RULES.skill_cap + ").", "rd"); return; }
    var nw2 = pl.skills[t] + 1, cost2 = nw2 * 3;
    if (pl.karma < cost2) { p("Need " + cost2 + " karma.", "rd"); return; }
    pl.karma -= cost2; pl.skills[t] = nw2; p(t + " raised to " + nw2 + ". -" + cost2 + " karma.", "gn");
  } else { p("Unknown attribute/skill.", "rd"); }
}
function attr_base(name) { return G.p.attrs[name] || 0; }

// ============================================================ save/load ====
function saveKey(slot) { return "neonsprawl:" + G.p.campaign + ":" + slot; }
function saveGame(slot, quiet) {
  try { localStorage.setItem(saveKey(slot), JSON.stringify(G.p)); if (!quiet) p("Game saved to " + slot + ".", "gn"); }
  catch (e) { if (!quiet) p("Save failed (browser storage blocked).", "rd"); }
}
function listSaves() {
  var out = [];
  try {
    var pre = "neonsprawl:" + DATA.manifest.id + ":";
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(pre) === 0) out.push(k.slice(pre.length)); }
  } catch (e) {}
  return out.sort();
}
function loadGame(slot) {
  try {
    var raw = localStorage.getItem("neonsprawl:" + DATA.manifest.id + ":" + slot);
    if (!raw) { p("No such save.", "rd"); return false; }
    G.p = JSON.parse(raw); G.mode = "explore";
    p("Loaded " + slot + ".", "gn"); describeRoom(); return true;
  } catch (e) { p("Load failed.", "rd"); return false; }
}

// ============================================================ char gen =====
function newPlayer(name, archName) {
  var a = RULES.archetypes[archName], man = DATA.manifest;
  var pl = {
    name: name, archetype: archName, akey: a.key,
    attrs: Object.assign({}, a.attrs), skills: Object.assign({}, a.skills),
    weapon: a.weapon, armor: a.armor,
    inventory: a.items.slice(), cyberware: a.cyberware.slice(), abilities: a.abilities.slice(),
    creds: man.start_creds != null ? man.start_creds : 250,
    karma: man.start_karma != null ? man.start_karma : 0,
    edge: a.edge, max_edge: a.edge, magic: a.key === "mage" ? 5 : 0,
    location: man.start_room, campaign: man.id,
    flags: [], quests: {}, used: [], visited: [], hp: 0,
  };
  (man.start_items || []).forEach(function (i) { pl.inventory.push(i); });
  if (man.start_weapon) pl.weapon = man.start_weapon;
  if (man.start_armor) pl.armor = man.start_armor;
  pl.hp = maxHp(pl);
  return pl;
}

// ============================================================ dispatch =====
function parse(raw) {
  raw = (raw || "").trim(); if (!raw) return;
  var low = raw.toLowerCase(), parts = low.split(/\s+/), cmd = parts[0], arg = raw.slice(cmd.length).trim();
  var larg = arg.toLowerCase();

  if (/^\d+$/.test(cmd)) { pickNumber(parseInt(cmd, 10)); return; }
  if (cmd === "go" || cmd === "move") { move(larg); return; }
  if (["n", "s", "e", "w", "u", "d", "north", "south", "east", "west", "up", "down", "deeper", "back", "in", "out"].indexOf(cmd) >= 0) { move(cmd); return; }
  if (cmd === "look" || cmd === "l") { describeRoom(); return; }
  if (cmd === "exits") { showExits(); return; }
  if (["stats", "stat", "char", "c"].indexOf(cmd) >= 0) { showStats(); return; }
  if (["inv", "i", "inventory"].indexOf(cmd) >= 0) { showInv(); return; }
  if (["quests", "quest", "q", "journal", "log"].indexOf(cmd) >= 0) { showQuests(); return; }
  if (cmd === "map" || cmd === "m") { showMap(); return; }
  if (["equip", "wield", "wear"].indexOf(cmd) >= 0) { cmdEquip(larg); return; }
  if (cmd === "install" || cmd === "jack") { cmdInstall(larg); return; }
  if (cmd === "use") { cmdUse(larg); return; }
  if (["improve", "train", "level"].indexOf(cmd) >= 0) { cmdImprove(); return; }
  if (cmd === "talk" || cmd === "t") { talkByName(larg); return; }
  if (["shop", "buy", "store"].indexOf(cmd) >= 0) { var r = room(); if (r.shop) openShop(r.shop); else p("No shop here.", "rd"); return; }
  if (cmd === "save") { saveGame(larg || "save1"); return; }
  if (cmd === "load") { loadGame(larg || "save1"); return; }
  if (["help", "h", "?"].indexOf(cmd) >= 0) { showHelp(); return; }
  p("Unknown command. Type 'help'.", "rd");
}
function pickNumber(n) {
  var seq = numberedTargets();
  if (n >= 1 && n <= seq.length) {
    var t = seq[n - 1];
    if (t.kind === "action") doAction(t.payload);
    else if (t.kind === "npc") { talk(t.payload); if (G.mode === "explore") showOptions(); }
    else openShop(t.payload);
  } else p("No such option.", "rd");
}
function talkByName(arg) {
  var r = room();
  var npcs = r.npcs || [];
  for (var i = 0; i < npcs.length; i++) { if (!arg || npcs[i].indexOf(arg) >= 0 || NPCS()[npcs[i]].name.toLowerCase().indexOf(arg) >= 0) { talk(npcs[i]); if (G.mode === "explore") showOptions(); return; } }
  p("There's no one here by that name.", "rd");
}

// main input entry: routes by mode
function submit(line) {
  line = (line == null ? "" : String(line));
  var m = G.mode;
  if (m === "combat") { handleCombat(line.trim().toLowerCase()); }
  else if (m === "combat_ability") { handleAbility(line.trim().toLowerCase()); }
  else if (m === "combat_item") { handleCombatItem(line.trim().toLowerCase()); }
  else if (m === "shop") { handleShop(line.trim().toLowerCase()); }
  else if (m === "sell") { handleSell(line.trim().toLowerCase()); }
  else if (m === "improve") { handleImprove(line); }
  else if (m === "dead" || m === "ending") { /* ignore */ }
  else { parse(line); }
}

// ============================================================ public API ===
var NS = {
  setTerminal: function (t) { T = t; },
  setRules: function (r) { RULES = r; },
  startCampaign: function (data) { DATA = data; },
  rules: function () { return RULES; },
  data: function () { return DATA; },
  archetypeList: function () { return Object.keys(RULES.archetypes); },
  newGame: function (name, archName) {
    G = { p: newPlayer(name, archName), mode: "explore", fx: [], combat: null, combatOnWin: null };
    return G;
  },
  prologue: function () {
    var man = DATA.manifest;
    blank(); banner("PROLOGUE", "mg");
    var txt = (man.prologue || "").replace(/\{name\}/g, G.p.name).replace(/\{archetype\}/g, G.p.archetype);
    p(txt || "Get moving, chummer.", "wh");
  },
  describeRoom: describeRoom,
  submit: submit,
  listSaves: listSaves,
  loadGame: function (slot) { G = { p: null, mode: "explore", fx: [], combat: null }; return loadGame(slot); },
  state: function () { return G; },
  mode: function () { return G ? G.mode : null; },
};

if (typeof module !== "undefined" && module.exports) module.exports = NS;
root.NEON = NS;

})(typeof window !== "undefined" ? window : globalThis);
