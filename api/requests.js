/*
 * Request processing part.
 * Here we process incoming requests before it reaches the main controller
 * 
 * */
module.exports = function (server) {

    server.use(function (req, res, next) {

        global.LIMIT = 20;
        global.PAGE = 0;
        global.SKIP = 0;

        if (req.query['limit'] != null && !isNaN(req.query['limit'])) global.LIMIT = parseInt(req.query['limit']);
        if (req.query['page'] != null && !isNaN(req.query['page'])) global.PAGE = parseInt(req.query['page']);
        
        if (req.query['skip'] != null && !isNaN(req.query['skip'])) {
            global.SKIP = parseInt(req.query['skip']);
        } else {
            global.SKIP = global.LIMIT * global.PAGE;
        }

        return next();
    });
}