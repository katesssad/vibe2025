const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const PORT = 3000;
const SESSION_SECRET = 'your-secret-key-here';
const TELEGRAM_TOKEN = '7604186300:AAFUeCVzHg6PXudGUToFN_Tl-WHzbfAeLaI'; 

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: 'qwerty54321',
    database: 'todolist',
};

// Инициализация Telegram бота
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

// Сессии в памяти
const sessions = {};
// Сессии Telegram пользователей
const telegramSessions = {};

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

function parseCookies(req) {
    const cookies = {};
    if (req.headers.cookie) {
        req.headers.cookie.split(';').forEach(cookie => {
            const parts = cookie.split('=');
            cookies[parts[0].trim()] = (parts[1] || '').trim();
        });
    }
    return cookies;
}

async function checkAuth(req) {
    const cookies = parseCookies(req);
    const sessionId = cookies.sessionId;
    
    if (!sessionId || !sessions[sessionId]) {
        return { isAuthenticated: false };
    }
    
    return { 
        isAuthenticated: true,
        userId: sessions[sessionId].userId,
        username: sessions[sessionId].username
    };
}

async function getUserByCredentials(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const hashedPassword = hashPassword(password);
    const [rows] = await connection.execute(
        'SELECT id, username FROM users WHERE username = ? AND password = ?',
        [username, hashedPassword]
    );
    await connection.end();
    return rows[0];
}

async function createUser(username, password) {
    const connection = await mysql.createConnection(dbConfig);
    const hashedPassword = hashPassword(password);
    const [result] = await connection.execute(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, hashedPassword]
    );
    await connection.end();
    return result.insertId;
}

async function retrieveListItems(userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [rows] = await connection.execute(
        'SELECT id, text FROM items WHERE user_id = ? ORDER BY id',
        [userId]
    );
    await connection.end();
    return rows;
}

async function addListItem(text, userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'INSERT INTO items (text, user_id) VALUES (?, ?)',
        [text, userId]
    );
    await connection.end();
    return result.insertId;
}

async function deleteListItem(id, userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'DELETE FROM items WHERE id = ? AND user_id = ?',
        [id, userId]
    );
    await connection.end();
    return result.affectedRows > 0;
}

async function updateListItem(id, text, userId) {
    const connection = await mysql.createConnection(dbConfig);
    const [result] = await connection.execute(
        'UPDATE items SET text = ? WHERE id = ? AND user_id = ?',
        [text, id, userId]
    );
    await connection.end();
    return result.affectedRows > 0;
}

async function serveLoginPage(res, isRegister = false) {
    try {
        let html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
        
        const authForm = `
            <div style="text-align: center; margin: 50px auto; width: 300px; background: #f9f9f9; padding: 20px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <h2>${isRegister ? 'Register' : 'Login'}</h2>
                <form onsubmit="handleAuth(event, ${isRegister})" style="margin-top: 20px;">
                    <input type="text" placeholder="Username" id="auth-username" style="width: 100%; padding: 8px; margin-bottom: 10px;"><br>
                    <input type="password" placeholder="Password" id="auth-password" style="width: 100%; padding: 8px; margin-bottom: 10px;"><br>
                    ${isRegister ? '<input type="password" placeholder="Confirm Password" id="auth-confirm" style="width: 100%; padding: 8px; margin-bottom: 10px;"><br>' : ''}
                    <button type="submit" style="padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        ${isRegister ? 'Register' : 'Login'}
                    </button>
                </form>
                <p style="margin-top: 15px;">
                    ${isRegister ? 'Already have an account? <a href="/login" style="color: #4CAF50;">Login</a>' : 
                                  'Need an account? <a href="/register" style="color: #4CAF50;">Register</a>'}
                </p>
            </div>
            <script>
                async function handleAuth(event, isRegister) {
                    event.preventDefault();
                    const username = document.getElementById('auth-username').value;
                    const password = document.getElementById('auth-password').value;
                    
                    if (isRegister) {
                        const confirm = document.getElementById('auth-confirm').value;
                        if (password !== confirm) {
                            alert('Passwords do not match');
                            return;
                        }
                    }
                    
                    try {
                        const response = await fetch(isRegister ? '/register' : '/login', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: 'username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password)
                        });
                        
                        const result = await response.json();
                        if (result.success) {
                            window.location.href = '/';
                        } else {
                            alert(result.message || 'Authentication failed');
                        }
                    } catch (error) {
                        console.error('Error:', error);
                        alert('Authentication failed');
                    }
                }
            </script>
        `;
        
        html = html.replace(/<body>[\s\S]*<\/body>/, `<body>${authForm}</body>`);
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading page');
    }
}

async function serveTodoList(res, userId, username) {
    try {
        let html = await fs.promises.readFile(path.join(__dirname, 'index.html'), 'utf8');
        
        const rows = (await retrieveListItems(userId)).map(item => `
            <tr>
                <td>${item.id}</td>
                <td class="item-text" data-id="${item.id}">${item.text}</td>
                <td>
                    <button class="action-btn delete-btn" onclick="removeItem(${item.id})">×</button>
                    <button class="action-btn edit-btn" onclick="enableEdit(${item.id})">✎</button>
                </td>
            </tr>
        `).join('');
        
        const userHeader = `<div style="text-align: right; margin: 10px 15% 0 0;">
            Logged in as <strong>${username}</strong> | 
            <a href="/logout" style="color: #ff4444;">Logout</a>
        </div>`;
        
        html = html.replace('<body>', `<body>${userHeader}`);
        html = html.replace('{{rows}}', rows);
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading page');
    }
}

// Функция для форматирования списка задач
function formatTasks(tasks) {
    if (tasks.length === 0) {
        return "У вас пока нет задач.";
    }
    
    return tasks.map(task => `${task.id}. ${task.text}`).join('\n');
}

// Обработчики команд Telegram бота
bot.onText(/\/начать/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Я бот для управления вашим To-Do списком. Используйте команды:\n' +
        '/задачи - показать все задачи\n' +
        '/добавить [текст] - добавить задачу\n' +
        '/изменить [номер] [новый текст] - изменить задачу\n' +
        '/удалить [номер] - удалить задачу\n' +
        '/вход [username] [password] - авторизация\n' +
        '/выход - выход из системы');
});

bot.onText(/\/задачи/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!telegramSessions[chatId] || !telegramSessions[chatId].userId) {
        bot.sendMessage(chatId, 'Сначала вам нужно авторизоваться. Пожалуйста, введите /вход [ваш_username] [ваш_пароль]');
        return;
    }
    
    try {
        const tasks = await retrieveListItems(telegramSessions[chatId].userId);
        bot.sendMessage(chatId, formatTasks(tasks) || "У вас пока нет задач.");
    } catch (error) {
        console.error('Error retrieving tasks:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при получении списка задач.');
    }
});

bot.onText(/\/добавить (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1];
    
    if (!telegramSessions[chatId] || !telegramSessions[chatId].userId) {
        bot.sendMessage(chatId, 'Сначала вам нужно авторизоваться. Пожалуйста, введите /вход [ваш_username] [ваш_пароль]');
        return;
    }
    
    try {
        await addListItem(text, telegramSessions[chatId].userId);
        bot.sendMessage(chatId, `Задача "${text}" успешно добавлена!`);
    } catch (error) {
        console.error('Error adding task:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при добавлении задачи.');
    }
});

bot.onText(/\/изменить (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = match[1];
    const newText = match[2];
    
    if (!telegramSessions[chatId] || !telegramSessions[chatId].userId) {
        bot.sendMessage(chatId, 'Сначала вам нужно авторизоваться. Пожалуйста, введите /вход [ваш_username] [ваш_пароль]');
        return;
    }
    
    try {
        const updated = await updateListItem(taskId, newText, telegramSessions[chatId].userId);
        if (updated) {
            bot.sendMessage(chatId, `Задача ${taskId} успешно обновлена!`);
        } else {
            bot.sendMessage(chatId, `Задача с ID ${taskId} не найдена.`);
        }
    } catch (error) {
        console.error('Error updating task:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при обновлении задачи.');
    }
});

bot.onText(/\/удалить (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const taskId = match[1];
    
    if (!telegramSessions[chatId] || !telegramSessions[chatId].userId) {
        bot.sendMessage(chatId, 'Сначала вам нужно авторизоваться. Пожалуйста, введите /вход [ваш_username] [ваш_пароль]');
        return;
    }
    
    try {
        const deleted = await deleteListItem(taskId, telegramSessions[chatId].userId);
        if (deleted) {
            bot.sendMessage(chatId, `Задача ${taskId} успешно удалена!`);
        } else {
            bot.sendMessage(chatId, `Задача с ID ${taskId} не найдена.`);
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при удалении задачи.');
    }
});

bot.onText(/\/вход (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const username = match[1];
    const password = match[2];
    
    try {
        const user = await getUserByCredentials(username, password);
        if (user) {
            telegramSessions[chatId] = {
                userId: user.id,
                username: user.username
            };
            bot.sendMessage(chatId, `Вы успешно авторизованы как ${user.username}! Теперь вы можете управлять своими задачами.`);
        } else {
            bot.sendMessage(chatId, 'Неверные учетные данные. Пожалуйста, проверьте имя пользователя и пароль.');
        }
    } catch (error) {
        console.error('Login error:', error);
        bot.sendMessage(chatId, 'Произошла ошибка при авторизации.');
    }
});

bot.onText(/\/выход/, (msg) => {
    const chatId = msg.chat.id;
    delete telegramSessions[chatId];
    bot.sendMessage(chatId, 'Вы успешно вышли из системы.');
});

// Обработка ошибок бота
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

async function handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const auth = await checkAuth(req);

    // Обработка статических файлов (CSS, JS)
    if (pathname.endsWith('.css') || pathname.endsWith('.js')) {
        try {
            const content = await fs.promises.readFile(path.join(__dirname, pathname));
            res.writeHead(200, { 'Content-Type': pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
            res.end(content);
        } catch (err) {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    // Маршруты авторизации
    if (pathname === '/login' || pathname === '/register') {
        if (req.method === 'GET') {
            await serveLoginPage(res, pathname === '/register');
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                const { username, password } = querystring.parse(body);
                
                if (!username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Username and password required' }));
                    return;
                }
                
                try {
                    let user;
                    if (pathname === '/register') {
                        const userId = await createUser(username, password);
                        user = { id: userId, username };
                    } else {
                        user = await getUserByCredentials(username, password);
                        if (!user) {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
                            return;
                        }
                    }
                    
                    const sessionId = generateSessionId();
                    sessions[sessionId] = { userId: user.id, username: user.username };
                    
                    res.writeHead(200, { 
                        'Content-Type': 'application/json',
                        'Set-Cookie': `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=86400`
                    });
                    res.end(JSON.stringify({ success: true }));
                } catch (error) {
                    console.error('Auth error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Authentication failed' }));
                }
            });
        }
        return;
    }

    // Выход из системы
    if (pathname === '/logout') {
        const cookies = parseCookies(req);
        if (cookies.sessionId) {
            delete sessions[cookies.sessionId];
        }
        res.writeHead(302, { 
            'Location': '/login',
            'Set-Cookie': 'sessionId=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'
        });
        res.end();
        return;
    }

    // Проверка авторизации для основных маршрутов
    if (!auth.isAuthenticated) {
        res.writeHead(302, { 'Location': '/login' });
        res.end();
        return;
    }

    // Главная страница с to-do листом
    if (pathname === '/') {
        await serveTodoList(res, auth.userId, auth.username);
        return;
    }

    // API для работы с задачами
    if (pathname === '/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { text } = querystring.parse(body);
            if (!text) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Text is required' }));
                return;
            }
            
            try {
                await addListItem(text, auth.userId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (error) {
                console.error('Error adding item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Error adding item' }));
            }
        });
        return;
    }

    if (pathname === '/delete' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { id } = querystring.parse(body);
            if (!id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'ID is required' }));
                return;
            }
            
            try {
                const deleted = await deleteListItem(id, auth.userId);
                if (deleted) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Item not found' }));
                }
            } catch (error) {
                console.error('Error deleting item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Error deleting item' }));
            }
        });
        return;
    }

    if (pathname === '/update' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', async () => {
            const { id, text } = querystring.parse(body);
            if (!id || !text) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'ID and text are required' }));
                return;
            }
            
            try {
                const updated = await updateListItem(id, text, auth.userId);
                if (updated) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Item not found' }));
                }
            } catch (error) {
                console.error('Error updating item:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Error updating item' }));
            }
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));