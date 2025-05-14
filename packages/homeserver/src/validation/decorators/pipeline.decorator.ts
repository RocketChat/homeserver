export function Pipeline() {
    return function(target: new (...args: any[]) => any): any {
        let instance: any;
        return class extends target {
            constructor(...args: any[]) {
                if (instance) {
                    return instance;
                }
                super(...args);
                instance = this;
            }
        };
    };
}