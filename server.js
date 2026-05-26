require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigin = process.env.FRONTEND_URL || "*";
const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD
  ? process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "")
  : "";
const mailTo = process.env.MAIL_TO;

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["POST"],
    allowedHeaders: ["Content-Type"]
  })
);
app.use(express.json({ limit: "10kb" }));

const contactLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 2,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "Limite anti spam alcanzado. Intentalo mas tarde."
  }
});

function getMissingEnvVars() {
  return ["GMAIL_USER", "GMAIL_APP_PASSWORD", "MAIL_TO"].filter((name) => !process.env[name]);
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: gmailUser,
    pass: gmailAppPassword
  }
});

function cleanText(value) {
  return String(value || "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Backend de contacto activo"
  });
});

app.post("/contact", contactLimiter, async (req, res) => {
  try {
    const missingEnvVars = getMissingEnvVars();

    if (missingEnvVars.length > 0) {
      console.error("Configuracion de correo incompleta en Railway:", {
        missingEnvVars,
        hasGmailUser: Boolean(gmailUser),
        hasGmailAppPassword: Boolean(gmailAppPassword),
        hasMailTo: Boolean(mailTo),
        frontendUrlConfigured: Boolean(process.env.FRONTEND_URL)
      });

      return res.status(500).json({
        ok: false,
        error: "Servidor de correo no configurado",
        code: "MAIL_ENV_MISSING"
      });
    }

    const nombre = cleanText(req.body.nombre);
    const correo = cleanText(req.body.correo);
    const negocio = cleanText(req.body.negocio);
    const mensaje = cleanText(req.body.mensaje);
    const honeypot = cleanText(req.body.website);

    if (honeypot) {
      return res.status(400).json({
        ok: false,
        error: "Solicitud invalida"
      });
    }

    if (!nombre || !correo || !mensaje) {
      return res.status(400).json({
        ok: false,
        error: "Nombre, correo y mensaje son obligatorios"
      });
    }

    if (!isValidEmail(correo)) {
      return res.status(400).json({
        ok: false,
        error: "Correo invalido"
      });
    }

    if (nombre.length > 120 || correo.length > 160 || negocio.length > 120 || mensaje.length > 2000) {
      return res.status(400).json({
        ok: false,
        error: "El contenido enviado es demasiado largo"
      });
    }

    const safeNombre = escapeHtml(nombre);
    const safeCorreo = escapeHtml(correo);
    const safeNegocio = escapeHtml(negocio || "No especificado");
    const safeMensaje = escapeHtml(mensaje).replace(/\n/g, "<br>");

    await transporter.sendMail({
      from: `"Formulario L.L.A Studio" <${gmailUser}>`,
      to: mailTo,
      replyTo: correo,
      subject: `Nuevo mensaje de ${nombre}`,
      text: [
        "Nuevo mensaje desde el formulario web:",
        "",
        `Nombre: ${nombre}`,
        `Correo: ${correo}`,
        `Tipo de negocio: ${negocio || "No especificado"}`,
        "",
        "Mensaje:",
        mensaje
      ].join("\n"),
      html: `
        <h2>Nuevo mensaje desde el formulario web</h2>
        <p><strong>Nombre:</strong> ${safeNombre}</p>
        <p><strong>Correo:</strong> ${safeCorreo}</p>
        <p><strong>Tipo de negocio:</strong> ${safeNegocio}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${safeMensaje}</p>
      `
    });

    console.log("Correo enviado correctamente desde /contact:", {
      to: mailTo,
      replyTo: correo,
      frontendOrigin: req.get("origin") || "sin origin"
    });

    return res.status(200).json({
      ok: true,
      message: "Mensaje enviado correctamente"
    });
  } catch (error) {
    console.error("Error completo enviando correo con Nodemailer:", {
      message: error.message,
      code: error.code,
      command: error.command,
      response: error.response,
      responseCode: error.responseCode,
      stack: error.stack
    });

    return res.status(500).json({
      ok: false,
      error: "Error al enviar el mensaje",
      code: error.code || "MAIL_SEND_ERROR"
    });
  }
});

app.listen(port, () => {
  console.log(`Servidor activo en puerto ${port}`);
  console.log("Configuracion de Railway cargada:", {
    hasGmailUser: Boolean(gmailUser),
    hasGmailAppPassword: Boolean(gmailAppPassword),
    hasMailTo: Boolean(mailTo),
    frontendUrl: process.env.FRONTEND_URL || "no configurado",
    corsOrigin: allowedOrigin
  });

  const missingEnvVars = getMissingEnvVars();

  if (missingEnvVars.length > 0) {
    console.error("Faltan variables de entorno para enviar correos:", missingEnvVars);
    return;
  }

  transporter.verify((error) => {
    if (error) {
      console.error("Nodemailer no pudo verificar Gmail SMTP:", {
        message: error.message,
        code: error.code,
        command: error.command,
        response: error.response,
        responseCode: error.responseCode,
        stack: error.stack
      });
      return;
    }

    console.log("Nodemailer conectado correctamente a Gmail SMTP");
  });
});
