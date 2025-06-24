const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const PORT = 3000;

// Database connection settings
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'qwerty54321',
    database: 'todolist',
};

// Простая "база данных" пользователей в памяти (в реальном приложении храните в БД)
const users = {
    // username: { passwordHash: 'hash', salt: 'salt' }
};

// Генерация хэша пароля
function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Middleware для проверки аутентификации
function checkAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;
    
    const [username, token] = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
    return users[username] && users[username].token === token ? username : null;
}

// Функции для работы с задачами (теперь учитывают пользователя)
async function retrieveListItems(username) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'SELECT id, text FROM items WHERE username = ?';
        const [rows] = await connection.execute(query, [username]);
        await connection.end();
        return rows;
    } catch (error) {
        console.error('Error retrieving list items:', error);
        throw error;
    }
}

async function addListItem(text, username) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'INSERT INTO items (text, username) VALUES (?, ?)';
        const [result] = await connection.execute(query, [text, username]);
        await connection.end();
        return result.insertId;
    } catch (error) {
        console.error('Error adding list item:', error);
        throw error;
    }
}

async function updateListItem(id, text, username) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'UPDATE items SET text = ? WHERE id = ? AND username = ?';
        await connection.execute(query, [text, id, username]);
        await connection.end();
    } catch (error) {
        console.error('Error updating list item:', error);
        throw error;
    }
}

async function removeListItem(id, username) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const query = 'DELETE FROM items WHERE id = ? AND username = ?';
        await connection.execute(query, [id, username]);
        await connection.end();
    } catch (error) {
        console.error('Error removing list item:', error);
        throw error;
    }
}

async function getHtmlRows(username) {
    const todoItems = await retrieveListItems(username);
    return todoItems.map(item => `
        <tr data-id="${item.id}">
            <td>${item.id}</td>
            <td class="item-text">${item.text}</td>
            <td>
                <button onclick="enableEdit(${item.id}, '${item.text.replace(/'/g, "\\'")}')">Edit</button>
                <button onclick="deleteItem(${item.id})">×</button>
            </td>
        </tr>
    `).join('');
}

async function handleRequest(req, res) {
    // Главная страница
    if (req.url === '/' && req.method === 'GET') {
        try {
            const username = checkAuth(req);
            let html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
            
            if (username) {
                // Авторизованный пользователь
                const processedHtml = html
                    .replace('{{rows}}', await getHtmlRows(username))
                    .replace('{{authSection}}', `
                        <div class="auth-info">
                            Logged in as: ${username} 
                            <button onclick="logout()">Logout</button>
                        </div>
                    `);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(processedHtml);
            } else {
                // Неавторизованный пользователь
                const loginForm = `
                    <div class="auth-form">
                        <h3>Login</h3>
                        <input type="text" id="loginUsername" placeholder="Username">
                        <input type="password" id="loginPassword" placeholder="Password">
                        <button onclick="login()">Login</button>
                        <p>Or <a href="#" onclick="showRegister()">register</a></p>
                    </div>
                    <div class="auth-form" id="registerForm" style="display:none;">
                        <h3>Register</h3>
                        <input type="text" id="regUsername" placeholder="Username">
                        <input type="password" id="regPassword" placeholder="Password">
                        <button onclick="register()">Register</button>
                        <p>Or <a href="#" onclick="showLogin()">login</a></p>
                    </div>
                `;
                const processedHtml = html
                    .replace('{{rows}}', '')
                    .replace('{{authSection}}', loginForm);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(processedHtml);
            }
        } catch (err) {
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error loading page');
        }
    }
    // Логин
    else if (req.url === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = users[username];
                
                if (user && user.passwordHash === hashPassword(password, user.salt)) {
                    const token = crypto.randomBytes(16).toString('hex');
                    users[username].token = token;
                    
                    res.writeHead(200, { 
                        'Content-Type': 'application/json',
                        'Set-Cookie': `auth=${username}:${token}; Path=/; HttpOnly`
                    });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
                }
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Login failed' }));
            }
        });
    }
    // Регистрация
    else if (req.url === '/register' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                
                if (users[username]) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Username already exists' }));
                    return;
                }
                
                const salt = crypto.randomBytes(16).toString('hex');
                const passwordHash = hashPassword(password, salt);
                const token = crypto.randomBytes(16).toString('hex');
                
                users[username] = { passwordHash, salt, token };
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': `auth=${username}:${token}; Path=/; HttpOnly`
                });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Registration failed' }));
            }
        });
    }
    // Выход
    else if (req.url === '/logout' && req.method === 'POST') {
        const username = checkAuth(req);
        if (username && users[username]) {
            delete users[username].token;
        }
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Set-Cookie': 'auth=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
        });
        res.end(JSON.stringify({ success: true }));
    }
    // API для задач (требует аутентификации)
    else {
        const username = checkAuth(req);
        if (!username) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
            return;
        }

        if (req.url === '/items' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const { text } = JSON.parse(body);
                    await addListItem(text, username);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Failed to add item' }));
                }
            });
        } 
        else if (req.url.startsWith('/items/') && req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const id = req.url.split('/')[2];
                    const { text } = JSON.parse(body);
                    await updateListItem(id, text, username);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (error) {
                    console.error(error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Failed to update item' }));
                }
            });
        } 
        else if (req.url.startsWith('/items/') && req.method === 'DELETE') {
            try {
                const id = req.url.split('/')[2];
                await removeListItem(id, username);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error(error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Failed to remove item' }));
            }
        } 
        else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Route not found');
        }
    }
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));