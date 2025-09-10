module.exports = {

    connect: function (params) {
        return this;
    },
    disconnect: function (params) {
        return this;
    },

    listTables: function (params) {
        return [];
    },
    listData: function (params) { 
        return false;
    },
    fetchData: function (params) { 
        return false;
    },

    insertData: function (params) { 
        return false;
    },
    updateData: function (params) { 

        return false;
    },
    deleteData: function (params) { 


        return false;
    },
};