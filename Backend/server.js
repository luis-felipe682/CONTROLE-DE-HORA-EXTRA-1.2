const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_clt';

app.use(cors());
app.use(express.json());

// Conexão com o banco PostgreSQL no Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicialização e criação automática das tabelas no PostgreSQL
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      cargo VARCHAR(255),
      salario NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lancamentos (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      data VARCHAR(10) NOT NULL,
      hora_inicio VARCHAR(5) NOT NULL,
      hora_fim VARCHAR(5) NOT NULL,
      porcentagem NUMERIC NOT NULL,
      justificativa TEXT,
      total_horas NUMERIC NOT NULL,
      valor_total_item NUMERIC NOT NULL
    );
  `);
}
initDb().catch(console.error);

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

  if (minFim < minInicio) minFim += 24 * 60;
  return (minFim - minInicio) / 60;
}

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha, cargo, salario } = req.body;
  if (!nome || !email || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
  }

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, cargo, salario) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [nome, email, senhaHash, cargo || '', salario || 0]
    );

    res.status(201).json({ message: 'Conta criada com sucesso!', id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') { // Código de erro de valor duplicado no Postgres
      return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
    }
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  const usuario = result.rows[0];

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  const token = jwt.sign({ id: usuario.id, email: usuario.email }, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    token,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo, salario: parseFloat(usuario.salario) }
  });
});

// --- ROTAS DE LANÇAMENTOS (PROTEGIDAS) ---

app.get('/api/lancamentos', autenticarToken, async (req, res) => {
  const { mesAno } = req.query;
  const userResult = await pool.query('SELECT id, nome, email, cargo, salario FROM usuarios WHERE id = $1', [req.user.id]);
  const usuario = userResult.rows[0];

  let query = 'SELECT id, data, hora_inicio AS "horaInicio", hora_fim AS "horaFim", porcentagem, justificativa, total_horas AS "totalHoras", valor_total_item AS "valorTotalItem" FROM lancamentos WHERE usuario_id = $1';
  const params = [req.user.id];

  if (mesAno) {
    query += ' AND data LIKE $2';
    params.push(`${mesAno}%`);
  }
  query += ' ORDER BY data DESC';

  const lancamentosResult = await pool.query(query, params);
  const lancamentos = lancamentosResult.rows.map(l => ({
    ...l,
    porcentagem: parseFloat(l.porcentagem),
    totalHoras: parseFloat(l.totalHoras),
    valorTotalItem: parseFloat(l.valorTotalItem)
  }));

  const salario = usuario ? parseFloat(usuario.salario) : 0;
  const valorHoraNormal = salario / 220;

  let totalHoras = 0;
  let totalReceberHE = 0;

  lancamentos.forEach(l => {
    totalHoras += l.totalHoras;
    totalReceberHE += l.valorTotalItem;
  });

  const valorDSR = totalReceberHE * (1 / 6);
  const totalGeral = totalReceberHE + valorDSR;

  res.json({
    usuario,
    resumo: { valorHoraNormal, totalHoras, totalReceberHE, valorDSR, totalGeral },
    lancamentos
  });
});

app.post('/api/lancamentos', autenticarToken, async (req, res) => {
  const { data, horaInicio, horaFim, porcentagem, justificativa } = req.body;
  const userResult = await pool.query('SELECT salario FROM usuarios WHERE id = $1', [req.user.id]);
  const usuario = userResult.rows[0];

  const totalHoras = calcularHoras(horaInicio, horaFim);
  const valorHoraNormal = usuario ? parseFloat(usuario.salario) / 220 : 0;
  const fatorAdicional = 1 + parseFloat(porcentagem) / 100;
  const valorTotalItem = totalHoras * valorHoraNormal * fatorAdicional;

  await pool.query(
    `INSERT INTO lancamentos (usuario_id, data, hora_inicio, hora_fim, porcentagem, justificativa, total_horas, valor_total_item)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [req.user.id, data, horaInicio, horaFim, porcentagem, justificativa, totalHoras, valorTotalItem]
  );

  res.status(201).json({ message: 'Lançamento salvo!' });
});

app.put('/api/lancamentos/:id', autenticarToken, async (req, res) => {
  const { id } = req.params;
  const { data, horaInicio, horaFim, porcentagem, justificativa } = req.body;
  const userResult = await pool.query('SELECT salario FROM usuarios WHERE id = $1', [req.user.id]);
  const usuario = userResult.rows[0];

  const totalHoras = calcularHoras(horaInicio, horaFim);
  const valorHoraNormal = usuario ? parseFloat(usuario.salario) / 220 : 0;
  const fatorAdicional = 1 + parseFloat(porcentagem) / 100;
  const valorTotalItem = totalHoras * valorHoraNormal * fatorAdicional;

  await pool.query(
    `UPDATE lancamentos 
     SET data = $1, hora_inicio = $2, hora_fim = $3, porcentagem = $4, justificativa = $5, total_horas = $6, valor_total_item = $7
     WHERE id = $8 AND usuario_id = $9`,
    [data, horaInicio, horaFim, porcentagem, justificativa, totalHoras, valorTotalItem, id, req.user.id]
  );

  res.json({ message: 'Lançamento atualizado!' });
});

app.delete('/api/lancamentos/:id', autenticarToken, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM lancamentos WHERE id = $1 AND usuario_id = $2', [id, req.user.id]);
  res.json({ message: 'Lançamento excluído!' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});