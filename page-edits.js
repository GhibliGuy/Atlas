// Your page edits, written by the Atlas page editor (the app's "Edit steps & notes" on a quest page) - edit there,
// not by hand. Keys: "quest:<questId>" -> { first, steps: [text], notes: text, done: true/false, updatedAt }; any page
// ("quest:<questId>", "monster:<id>", "npc:<id>", "item:<id>", "resource:<id>", "guide:<slug>") can also have
// sections: { <section>: { top, end, replace, hide } } ("_intro" = above the first heading) and added: [{ id, after,
// title, text }] (Edit page in the top bar). In the text,
// [[#/npc/stablemaster|Stablemaster]] is a link, [[map:npc:stablemaster|Stablemaster]] a button that shows it on the
// map (npc, monster, item, resource, place or zone), [[spot:24,-57|Black horse]] a spot on the map, **bold** bold.
globalThis.BXC_PAGE_EDITS = {
 "v": 1,
 "pages": {
  "quest:wasteland-nothing-gets-through": {
   "first": "",
   "steps": [
    "Get [[#/item/gold-arms|Gold Arms]], [[#/item/gold-sword|Gold Sword]] or [[#/item/gold-scribing-quill|Gold Scribing Quill]], **Excellent** quality or better.",
    "Bring it back to [[#/npc/wilson-barthrone|Wilson Barthrone]] to finish the quest."
   ],
   "notes": "Steps 2 and 3 are as reported by players who finished it.",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:imp-menace": {
   "first": "",
   "steps": [
    "Kill the Big Imp inside [[map:place:Imp Tree|Imp Tree]].",
    "Go back to [[#/npc/mira|Mira]] to finish the quest. [[map:npc:mira|Show on map]]"
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:plymouth-cargo-for-the-isle": {
   "first": "",
   "steps": [
    "Kill ogres in the [[map:place:Ogre Den|Ogre Den]], east of Underleaf, until you have **5** [[#/item/ogre-isle-supply-crate|Crates of Ogre Isle Supplies]] (a quest item). The den's ogres are level **29** at the entrance up to **33** at the bottom.",
    "Bring them back to [[#/npc/gerald-seabroden|Gerald Seabroden]] to finish the quest."
   ],
   "notes": "Steps 2 and 3 are as reported by players who finished it; the crate and the Ogre Den are from the game itself, the den’s levels from the news ([[https://binxonia.com/news/update-ogre-isle-opens-at-thirty|Ogre Isle Opens at Thirty]], 26 Sep 2026: they were 35 to 40 before).",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:plymouth-the-ogre-traitor": {
   "first": "",
   "steps": [
    "Kill the [[#/npc/ogre-traitor|Ogre Traitor]] inside the [[map:place:Ogre Den|Ogre Den]] - a level 34 boss at the bottom of the den (level 45 before 26 Sep 2026).",
    "Go back to [[#/npc/gerald-seabroden|Gerald Seabroden]] to finish the quest. [[map:npc:gerald-seabroden|Show on map]]"
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:warrior-spear-beyond-the-point": {
   "first": "",
   "steps": [
    "Kill orcs near the Orc Lair for **8** [[#/item/stolen-patrol-fitting|Stolen Patrol Fittings]] - each orc drops one.",
    "Bring the fittings back to [[#/npc/guard-tobin-reed|Guard Tobin Reed]] - he tells you who leads the raids.",
    "Kill [[#/npc/varruk-the-raider|Varruk the Raider]] [[spot:-145,82|Varruk the Raider]] - a level 10 orc at the southwest edge of the same camp.",
    "Go back to [[#/npc/guard-tobin-reed|Guard Tobin Reed]] to finish the quest. [[spot:-157,100|Guard Tobin Reed]]"
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:warrior-mace-the-broken-hammers": {
   "first": "",
   "steps": [
    "Kill goblins in [[map:zone:-43|Rustpick Mine]] until you have **5** [[#/item/stolen-smith-tool|Stolen Smith Tools]] (a quest item).",
    "Bring them back to [[#/npc/hester-bell|Hester Bell]].",
    "Kill the goblins’ boss, [[#/npc/nib-the-toolkeeper|Nib the Toolkeeper]] (a level 12 goblin in Rustpick Mine).",
    "Go back to [[#/npc/hester-bell|Hester Bell]] to finish the quest."
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:plymouth-carpenters-trade": {
   "first": "",
   "steps": [
    "Saw **10** [[#/item/pine-plank|Pine Planks]] at the sawmill in Hollis Tamber's yard at Plymouth Wharf and bring them to him. [[spot:166,-60|Hollis Tamber's yard]]",
    "Hammer out **5** sets of [[#/item/iron-fittings|Iron Fittings]] at the anvil in Hollis Tamber's yard and bring them to him. [[spot:166,-60|Hollis Tamber's yard]]",
    "Speak with [[#/npc/hollis-tamber|Hollis Tamber]] at Plymouth Wharf to finish the quest. [[spot:166,-60|Hollis Tamber]]"
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  },
  "quest:binxonia-runaway-horses": {
   "first": "",
   "steps": [
    "Send the three horses home:\n**Black horse**, in the Binxonian Woodlands [[spot:24,-57|Black horse]] - a short ride from the Stablemaster, on the way to the Binxonia Iron Mine\n**Brown horse**, in the Western Binxonian Woodlands [[spot:-24,188|Brown horse]] - a short walk from where an [[#/item/warp-underleaf|Underleaf teleport scroll]] drops you\n**White horse**, on the Longmeadow Plains [[spot:456,157|White horse]] - right next to where an [[#/item/warp-appleseed-farm|Appleseed Farm teleport scroll]] drops you",
    "Return to the [[#/npc/stablemaster|Stablemaster]] in Binxonia to finish the quest. [[spot:61,-18|Stablemaster]]"
   ],
   "notes": "",
   "done": true,
   "updatedAt": 1791074181217
  }
 }
};
