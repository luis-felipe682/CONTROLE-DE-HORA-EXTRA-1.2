# ⏱️ Controle de Horas Extras CLT (v1.2)

Aplicação web full-stack desenvolvida para auxílio no registro, gestão e cálculo automático de horas extras e reflexos no Descanso Semanal Remunerado (DSR) conforme as regras da CLT.

---

## 🌐 Links da Aplicação no Ar

* **Frontend (Aplicação Web):** [https://controle-de-hora-extra-1-2.vercel.app](https://controle-de-hora-extra-1-2.vercel.app)
* **Backend (API Rest):** [https://controle-de-hora-extra-1-2.onrender.com](https://controle-de-hora-extra-1-2.onrender.com)

---

## 🚀 Tecnologias Utilizadas

* **Backend:** Node.js, Express, CORS
* **Banco de Dados:** SQLite (`better-sqlite3`)
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla JS)
* **Hospedagem:** Render (Backend API) e Vercel (Frontend)

---

## 📋 Funcionalidades

* **Perfil do Colaborador:** Registro de salário e cálculo do valor/hora base.
* **Lançamento de Horas Extras:**
  * Adicional de **50%** (Dias úteis / Sábados).
  * Adicional de **100%** (Domingos e Feriados).
* **Cálculos Automáticos (CLT):**
  * Subtotal de horas extras acumuladas.
  * Estimativa do reflexo no **DSR (Descanso Semanal Remunerado)**.
  * Valor total geral a receber.
* **Recursos do Sistema:**
  * Filtro de lançamentos por mês/ano.
  * Exportação do extrato em formato **CSV**.
  * Gerenciamento completo (**CRUD** - Criar, Editar e Excluir registros).