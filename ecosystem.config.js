module.exports = {
  apps: [{
    name: "apidb",
    script: "main.js",
    watch: true,
    // Delay between restart
    watch_delay: 1000,
    ignore_watch : ["node_modules", "logs", "temp", "tmp", "data"],
    watch_options: {
      "followSymlinks": false
    }
  }]
}