export function Validator() {
    return <T extends new (...args: any[]) => any>(target: T): T => {
        let instance: any;
        
        const SingletonClass = class extends target {
            constructor(...args: any[]) {
                if (instance) {
                    super(...args);
                    Object.assign(this, instance);
                } else {
                    super(...args);
                    instance = this;
                }
            }
        };
        
        return SingletonClass as T;
    };
}