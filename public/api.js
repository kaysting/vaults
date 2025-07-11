const initApi = (authToken) => ({
    auth: {
        get: async () => {
            try {
                const res = await axios.get('/api/auth', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        login: async (username, password) => {
            try {
                const res = await axios.post('/api/auth/login', { username, password });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        logout: async () => {
            try {
                const res = await axios.post('/api/auth/logout', {}, {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        }
    },
    vaults: {
        list: async () => {
            try {
                const res = await axios.get('/api/vaults', {
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        }
    },
    files: {
        list: async (vault, path) => {
            try {
                const res = await axios.get('/api/files/list', {
                    headers: { Authorization: `Bearer ${authToken}` },
                    params: { vault, path }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        folderCreate: async (vault, path) => {
            try {
                const res = await axios.post('/api/files/folder/create', null, {
                    params: { vault, path },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        delete: async (vault, path) => {
            try {
                const res = await axios.post('/api/files/delete', null, {
                    params: { vault, path },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        move: async (vault, path_src, path_dest, overwrite = false) => {
            try {
                const res = await axios.post('/api/files/move', null, {
                    params: { vault, path_src, path_dest, overwrite: overwrite ? 'true' : '' },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        copy: async (vault, path_src, path_dest, overwrite = false) => {
            try {
                const res = await axios.post('/api/files/copy', null, {
                    params: { vault, path_src, path_dest, overwrite: overwrite ? 'true' : '' },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        uploadCreate: async (vault, path, size, overwrite = false) => {
            try {
                const res = await axios.post('/api/files/upload/create', null, {
                    params: { vault, path, size, overwrite: overwrite ? 'true' : '' },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        upload: async (chunk, offset, token, vault, onUploadProgress) => {
            try {
                const res = await axios.post('/api/files/upload', chunk, {
                    headers: {
                        Authorization: `Bearer ${authToken}`,
                        'Content-Type': 'application/octet-stream'
                    },
                    params: { token, vault, offset },
                    onUploadProgress
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        uploadFinalize: async (token, vault, overwrite = false) => {
            try {
                const res = await axios.post('/api/files/upload/finalize', null, {
                    params: { token, vault, overwrite: overwrite ? 'true' : '' },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        uploadCancel: async (token) => {
            try {
                const res = await axios.post('/api/files/upload/cancel', null, {
                    params: { token },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        downloadCreate: async (vault) => {
            try {
                const res = await axios.post('/api/files/download/create', null, {
                    params: { vault },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        downloadAdd: async (token, vault, paths) => {
            try {
                const res = await axios.post('/api/files/download/add', { paths }, {
                    params: { token, vault },
                    headers: { Authorization: `Bearer ${authToken}` }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        },
        downloadGet: async (token) => {
            try {
                const res = await axios.get('/api/files/download', {
                    headers: { Authorization: `Bearer ${authToken}` },
                    params: { token }
                });
                return res.data;
            } catch (error) {
                const resp = error.response?.data || {};
                return { code: resp.code, message: resp.message || error.toString() };
            }
        }
    }
});