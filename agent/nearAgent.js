// agent/nearAgent.js
// Singleton AI agent — only called by backend/services/agentConnector.js
// This file is here for direct invocation if needed, but agentConnector
// already handles all NEAR AI calls. Keep this as the canonical reference.

require("dotenv").config();
const fetch = require("node-fetch");
const fs    = require("fs");
const path  = require("path");

const ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://api.near.ai/v1/chat/completions";
const API_KEY  = process.env.NEAR_AI_KEY       || "";
const MODEL    = process.env.NEAR_AI_MODEL     || "llama-3.1-70b-instruct";

const PROMPT_FILE  = path.join(__dirname, "activePrompt.json");
const MISSION_FILE = path.join(__dirname, "activeMission.json");

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };

class NearAgent {
  constructor() {
    this.endpoint = ENDPOINT;
    this.apiKey   = API_KEY;
    this.model    = MODEL;
  }

  getSystemPrompt() {
    const govPrompt  = readJson(PROMPT_FILE).content  || "";
    const govMission = readJson(MISSION_FILE).content || "Monitor for scams, phishing links, and malicious wallets.";
    return [
      "You are IronClaw, a Web3 AI security and intelligence agent.",
      `Current mission: ${govMission}`,
      govPrompt ? `Governance instructions: ${govPrompt}` : "",
      "Always respond in valid JSON only. No markdown. No explanation outside JSON.",
      "Flag all risks clearly. Be concise and accurate.",
    ].filter(Boolean).join("\n");
  }

  async dispatch(userPrompt) {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(this.endpoint, {
        method:  "POST",
        signal:  controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 800,
          messages: [
            { role: "system", content: this.getSystemPrompt() },
            { role: "user",   content: userPrompt },
          ],
        }),
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`NEAR AI returned ${res.status}: ${await res.text()}`);
      const json  = await res.json();
      const text  = json.choices?.[0]?.message?.content || "{}";
      const clean = text.replace(/```json|```/g, "").trim();
      return JSON.parse(clean);
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`NearAgent dispatch failed: ${err.message}`);
    }
  }

  summarize(payload)  { return this.dispatch(require("./tasks/summaryTask").buildPrompt(payload)); }
  research(payload)   { return this.dispatch(require("./tasks/researchTask").buildPrompt(payload)); }
  verify(payload)     { return this.dispatch(require("./tasks/verifyTask").buildPrompt(payload)); }
  portfolio(payload)  { return this.dispatch(require("./tasks/portfolioTask").buildPrompt(payload)); }
}

module.exports = new NearAgent();
