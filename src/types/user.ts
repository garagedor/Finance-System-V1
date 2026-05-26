export type User = {
    _id?: string;
    name: string;
    password: string;
    type: 'admin' | 'office' | 'location-manager' | 'simple';
};

export type AuthUser = Omit<User, 'password'> & {
    token?: string;
};
