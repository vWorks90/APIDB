/*
 * All Security Logic is written here
 * 
 * */
module.exports = function(server) {

    server.use(function(req, res, next) {
        console.log("Security Middleware Triggered", req.getPath(), req.method, "Header:  ",req.headers);
        //API Validator : FIND API Authentication Protocol for the GUID
        //Could be Bearer, OAuth2, 2FA, etc.

        // console.log(req.headers);

        path = req.getPath();
        console.log("Security Path", path);
        pathRoot = req.getPath().substring(1).split("/")[0].toLowerCase();
        console.log("Security Path Root", pathRoot);

        if(CONFIG.noauth.indexOf(path)>=0) {
            return next();
        }

        authKey = req.header("authorization");
        // authKey = req.header("postman-token");
        console.log("Security auth: ", authKey)
        // if(authKey==null) {
        //     return next(
        //         new server.errors.ForbiddenError("Public Key Invalid")
        //     );
        // }
        // authKeyPayload = authKey.replace("x-apidb-token","").trim();
        // console.log("Security Authorization",authKey,authKeyPayload);
        
        // switch(pathRoot) {
        //     case "":
        //         break;
        //     case "admin":
        //         break;
        //     default:
        //         dbKey = req.header("x-apidb-dbkey");
        //         if (dbKey == null || dbKey.length<=0 || Object.keys(CONNECTPARAMS).indexOf(dbKey)<0) {
        //             return next(
        //                 new server.errors.ForbiddenError("APIKEY Invalid")
        //             );
        //         }
        //         break;
        // }
        
        return next();
    });


    // const rjwt = require('restify-jwt-community');

    // // using restify-jwt to lock down everything except /auth
    // server.use(rjwt(server.config.jwt).unless({
    //       path: server.config.noauth,
    //       method: 'OPTIONS'
    //   }));

    // server.use((req, res, next) => {
    //     if(req.method=="OPTIONS") {
    //       return next();
    //     }
    //     if(req.user==null) {
    //       if(server.config.noauth.indexOf(req._url.path)>=0) {
    //         //console.log("NoAuth Request Allowed",req._url.path);
    //       } else {
    //         console.log("NoAuth Request Denied",req._url.path);
    //         return next(new errs.UnauthorizedError("No Authorization Available"));
    //       }
    //     } else {
    //       pathParent = req._url.path.split("/")[1] + "/";
    //       req.user.scope.push("/auth/info");
    //       //console.log(pathParent,req._url.path,req.user.scope);
    //       if(req.user.scope.indexOf("*")>=0 || req.user.scope.indexOf(req._url.path)>=0 || req.user.scope.indexOf(pathParent)>=0) {
    //         console.log("New Authorized Request Allowed");
    //       } else {
    //         console.log("Auth Request Denied Due to Scope");
    //         return next(new errs.UnauthorizedError("Out of Scope Error"));
    //       }
    //     }
    //     return next();
    // });
}