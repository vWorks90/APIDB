/*
 * APIDB caching functions
 * 
 * */

const ioredis = require("ioredis");
const redis = new ioredis(CONFIG.cache);
//const redisClient = redis.createClient();

/*
 * Cache Storage Controls all the Caching Functionality. It helps speed up fetching various cached data directly
 * using indexes. This is important as REDIS Cache forms the core to our speed
 * 
 * */
module.exports = {

    cacheStatus: function () {
        return redis.status;
    },

    clearCache: function(pattern) {
        if(pattern==null) pattern = "*";
        //'sample_pattern:*'
        return redis.keys(pattern).then(function (keys) {
            // Use pipeline instead of sending one command each time to improve the performance.
            var pipeline = redis.pipeline();
            keys.forEach(function (key) {
              pipeline.del(key);
            });
            return pipeline.exec();
          });
    },

    storeData: function (cacheKey, data) {
        if (redis.status != "ready") return data;

        if (typeof data == "object") data = JSON.stringify(data);
        redis.set(cacheKey, data);
        return data;
    },

    fetchData: function (cacheKey, callback, defaultData = false) {
        if (redis.status != "ready") {
            callback(defaultData, "error");
            return;
        }
        cacheObj = this;
        result = false;

        redis.get(cacheKey).then(function (result) {
            if (result == null) {
                result = cacheObj.storeData(cacheKey, defaultData);
            }

            if (typeof result == "string") {
                try {
                    resultJSON = JSON.parse(result);
                    if (resultJSON != null) {
                        result = resultJSON;
                    }
                } catch (e) {

                }
            }

            callback(result);
        });
    }
}