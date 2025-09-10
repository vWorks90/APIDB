// Validation Functions Across System

const Validator = require('validatorjs');
module.exports = {
    initialize: function () {
        // If you want to register more custom validators later, do it here.
        // Currently, the 'mobile' validator is already registered above.
        console.log("VALIDATOR Initialized");
    },

    validateRule: function (formData, ruleObj) {
        const validation = new Validator(formData, ruleObj);

        return {
            status: validation.passes(),
            errors: validation.errors.all()
        };
    },

    validateExample: function () {
        let data = {
            name: 'John',
            email: 'johndoe@gmail.com',
            age: 28
        };

        let rules = {
            name: 'required',
            email: 'required|email',
            age: 'min:18'
        };

        let validation = new Validator(data, rules);

        console.log("Validation Passes:", validation.passes()); // true
        console.log("Validation Fails:", validation.fails());   // false
    }
};
