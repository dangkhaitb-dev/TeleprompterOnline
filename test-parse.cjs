const config = require("./eleventy.config.cjs");
const eleventyConfig = {
  addWatchTarget: () => {},
  addGlobalData: (key, data) => {
    if (key === "blogArticles") {
      const hub = data.find(a => a.slug === "teleprompter-guides");
      const heading = hub.content.find(b => b.type === "heading" && b.text.startsWith("["));
      console.log("HEADING TEXT:", heading.text);
      console.log("HEADING HTML:", heading.headingHtml);
      console.log("HEADING ID:", heading.id);
    }
  },
  addFilter: () => {},
  on: () => {}
};
config(eleventyConfig);
