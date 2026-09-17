const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_clt';

app.use(cors());
app.use(express.json());

// Conexão com o Banco de Dados
const db = new Database('database.db');

// Criar tabelas com suporte a multi-usuário
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    cargo TEXT,
    salario REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS lancamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    horaInicio TEXT NOT NULL,
    horaFim TEXT NOT NULL,
    porcentagem REAL NOT NULL,
    justificativa TEXT,
    totalHoras REAL NOT NULL,
    valorTotalItem REAL NOT NULL,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
`);

// Middleware de Autenticação JWT
function autenticarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acesso negado. Faça login.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Sessão expirada. Faça login novamente.' });
    req.user = user;
    next();
  });
}

// Auxiliar: Cálculo de Horas Extras
function calcularHoras(inicio, fim) {
  const [hI, mI] = inicio.split(':').map(Number);
  const [hF, mF] = fim.split(':').map(Number);
  let minInicio = hI * 60 + mI;
  let minFim = hF * 60 + mF;

  if (minFim < minInicio) minFim += 24 * 60; // Trata virada da noite
  return (minFim - minInicio) / 60;
}

// --- ROTAS DE AUTENTICAÇÃO ---

// Cadastrar Conta
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, cargo, salario } = req.body;
  if (!nome || !email || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const stmt = db.prepare('INSERT INTO usuarios (nome, email, senha, cargo, salario) VALUES (?, ?, ?, ?, ?)');
    const info = stmt.run(nome, email, senhaHash, cargo || '', salario || 0);

    res.status(201).json({ message: 'Conta criada com sucesso!', id: info.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo, salario: usuario.salario }
  });
});

// Atualizar Dados do Perfil do Usuário
app.put('/api/usuario/perfil', autenticarToken, (req, res) => {
  const { cargo, salario } = req.body;
  db.prepare('UPDATE usuarios SET cargo = ?, salario = ? WHERE id = ?').run(cargo, salario, req.user.id);
  res.json({ message: 'Perfil atualizado!' });
});

// --- ROTAS DE LANÇAMENTOS (PROTEGIDAS) ---

// Obter Extrato / Resumo
app.get('/api/lancamentos', autenticarToken, (req, res) => {
  const { mesAno } = req.query;
  const usuario = db.prepare('SELECT id, nome, email, cargo, salario FROM usuarios WHERE id = ?').get(req.user.id);

  let query = 'SELECT * FROM lancamentos WHERE usuario_id = ?';
  const params = [req.user.id];

  if (mesAno) {
    query += ' AND data LIKE ?';
    params.push(`${mesAno}%`);
  }
  query += ' ORDER BY data DESC';

  const lancamentos = db.prepare(query).all(...params);

  // Cálculos CLT
  const salario = usuario ? usuario.salario : 0;
  const valorHoraNormal = salario / 220;

  let totalHoras = 0;
  let totalReceberHE = 0;

  lancamentos.forEach(l => {
    totalHoras += l.totalHoras;
    totalReceberHE += l.valorTotalItem;
  });

  const valorDSR = totalReceberHE * (1 / 6); // Estimativa DSR CLT (1/6 da soma)
  const totalGeral = totalReceberHE + valorDSR;

  res.json({
    usuario,
    resumo: { valorHoraNormal, totalHoras, totalReceberHE, valorDSR, totalGeral },
    lancamentos
  });
});

// Salvar Lançamento
app.post('/api/lancamentos', autenticarToken, (req, res) => {
  const { data, horaInicio, horaFim, porcentagem, justificativa } = req.body;
  const usuario = db.prepare('SELECT salario FROM usuarios WHERE id = ?').get(req.user.id);

  const totalHoras = calcularHoras(horaInicio, horaFim);
  const valorHoraNormal = usuario ? usuario.salario / 220 : 0;
  const fatorAdicional = 1 + parseFloat(porcentagem) / 100;
  const valorTotalItem = totalHoras * valorHoraNormal * fatorAdicional;

  const stmt = db.prepare(`
    INSERT INTO lancamentos (usuario_id, data, horaInicio, horaFim, porcentagem, justificativa, totalHoras, valorTotalItem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(req.user.id, data, horaInicio, horaFim, porcentagem, justificativa, totalHoras, valorTotalItem);

  res.status(201).json({ message: 'Lançamento salvo!' });
});

// Editar Lançamento
app.put('/api/lancamentos/:id', autenticarToken, (req, res) => {
  const { id } = req.params;
  const { data, horaInicio, horaFim, porcentagem, justificativa } = req.body;
  const usuario = db.prepare('SELECT salario FROM usuarios WHERE id = ?').get(req.user.id);

  const totalHoras = calcularHoras(horaInicio, horaFim);
  const valorHoraNormal = usuario ? usuario.salario / 220 : 0;
  const fatorAdicional = 1 + parseFloat(porcentagem) / 100;
  const valorTotalItem = totalHoras * valorHoraNormal * fatorAdicional;

  const stmt = db.prepare(`
    UPDATE lancamentos 
    SET data = ?, horaInicio = ?, horaFim = ?, porcentagem = ?, justificativa = ?, totalHoras = ?, valorTotalItem = ?
    WHERE id = ? AND usuario_id = ?
  `);
  stmt.run(data, horaInicio, horaFim, porcentagem, justificativa, totalHoras, valorTotalItem, id, req.user.id);

  res.json({ message: 'Lançamento atualizado!' });
});

// Deletar Lançamento
app.delete('/api/lancamentos/:id', autenticarToken, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM lancamentos WHERE id = ? AND usuario_id = ?').run(id, req.user.id);
  res.json({ message: 'Lançamento excluído!' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});