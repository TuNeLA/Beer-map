// X10 load test: shared settings. STAGING ONLY. Refuses the live project.
const URL = process.env.PN_STAGING_URL || "https://vdtmzsxajpvzwwbhnfmr.supabase.co";
const KEY = process.env.PN_STAGING_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkdG16c3hhanB2end3YmhuZm1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwOTIxNzQsImV4cCI6MjEwOTY2ODE3NH0.bk45yZXL0OrHWSrZrAhFJpbtBXgzD_CDVbnoZrKCS-w";
if (/wcdskpcevbhouvbytkhv/.test(URL + KEY)) { console.error("REFUSING: live project"); process.exit(1); }
const H = (jwt) => ({ apikey: KEY, authorization: "Bearer " + (jwt || KEY), "content-type": "application/json" });
module.exports = { URL, KEY, H };
