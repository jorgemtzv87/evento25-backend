const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const cors = require('cors');

// Carga las credenciales
const creds = require('./credentials.json');

// Configura el cliente JWT
const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

// ID de tu hoja de cálculo (está en la URL: .../d/AQUI_VA_EL_ID/edit)
const SPREADSHEET_ID = '1uEtN0EITwz7N3DesKw988OPckIu4fsWl3sN42O7Kl90'; 
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

const app = express();
app.use(express.json()); // Para entender JSON en las peticiones
app.use(cors());
app.use(express.static('public')); // (Opcional) Para servir el index.html

const PORT = process.env.PORT || 3000;

// ==========================================================
// ENDPOINT 1: VERIFICAR VENDEDOR (El que ya teníamos)
// ==========================================================
app.post('/verificar-rfid', async (req, res) => {
  try {
    const { rfid_uid } = req.body; 
    if (!rfid_uid) {
      return res.status(400).json({ error: 'Falta rfid_uid' });
    }

    await doc.loadInfo(); 
    const sheet = doc.sheetsByIndex[0]; 
    const rows = await sheet.getRows();

    const vendedorRow = rows.find(row => row.get('UID') === rfid_uid);

    if (vendedorRow) {
      const vendedorData = {
        nombre: vendedorRow.get('Nombre'),
        ife: vendedorRow.get('IFE'),
        telefono: vendedorRow.get('Telefono'),
        lider: vendedorRow.get('Lider'),
        comision: vendedorRow.get('Comision_Venta')
      };
      return res.status(200).json({ success: true, vendedor: vendedorData });
    } else {
      return res.status(404).json({ success: false, error: 'Vendedor no registrado' });
    }

  } catch (error) {
    console.error('Error procesando la solicitud:', error);
    return res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// ==========================================================
// ENDPOINT 2: REGISTRAR NUEVO VENDEDOR (El nuevo)
// ==========================================================
app.post('/registrar-vendedor', async (req, res) => {
    try {
        // 1. Recibe todos los datos del formulario
        const { uid, nombre, ife, telefono, lider, comision } = req.body;

        // 2. Validación simple (puedes agregar más)
        if (!uid || !nombre || !ife) {
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios (UID, Nombre, IFE)' });
        }

        // 3. Carga la hoja y añade la nueva fila
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0]; // Asume la primera hoja

        // 4. Comprueba si el UID ya existe
        const rows = await sheet.getRows();
        const existingRow = rows.find(row => row.get('UID') === uid);
        if (existingRow) {
            return res.status(409).json({ success: false, error: 'Este UID ya está registrado.' });
        }

        // 5. Añade la fila (los nombres deben coincidir con tus columnas)
        await sheet.addRow({
            UID: uid,
            Nombre: nombre,
            IFE: ife,
            Telefono: telefono,
            Lider: lider,
            Comision_Venta: comision
        });

        console.log(`Vendedor registrado: ${nombre} con UID: ${uid}`);
        return res.status(201).json({ success: true, message: 'Vendedor registrado exitosamente' });

    } catch (error) {
        console.error('Error al registrar:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
    
});
// ==========================================================
// ENDPOINT 3: ASIGNAR PIZZAS (INVENTARIO) - PRECIO FIJO
// ==========================================================
app.post('/asignar-pizzas', async (req, res) => {
    try {
        // CAMBIO 1: Ya no pedimos 'precioUnitario'
        const { uid, pizzasAsignadas } = req.body; 
        
        // CAMBIO 2: Validación actualizada
        if (!uid || !pizzasAsignadas) { 
            return res.status(400).json({ success: false, error: 'Faltan campos (UID, Pizzas)' });
        }

        await doc.loadInfo();
        
        // 1. Buscar Vendedor (de la hoja "Vendedores")
        const sheetVendedores = doc.sheetsByTitle['Vendedores'];
        if (!sheetVendedores) return res.status(500).json({ error: 'Hoja "Vendedores" no encontrada' });
        
        const rowsVendedores = await sheetVendedores.getRows();
        const vendedorRow = rowsVendedores.find(row => row.get('UID') === uid);
        
        if (!vendedorRow) {
            return res.status(404).json({ success: false, error: 'Vendedor no encontrado' });
        }
        const nombreVendedor = vendedorRow.get('Nombre');

        // 2. Registrar Asignación (en la hoja "Asignaciones")
        const sheetAsignaciones = doc.sheetsByTitle['Asignaciones'];
        if (!sheetAsignaciones) return res.status(500).json({ error: 'Hoja "Asignaciones" no encontrada' });

        const timestamp = new Date().toISOString();

        await sheetAsignaciones.addRow({
            UID_Vendedor: uid,
            Nombre_Vendedor: nombreVendedor,
            Pizzas_Asignadas: pizzasAsignadas,
            Precio_Unitario: 125, // <--- CAMBIO 3: Precio fijado en 125
            Timestamp_Asignacion: timestamp
        });

        return res.status(201).json({ success: true, message: 'Asignación registrada exitosamente' });

    } catch (error) {
        console.error('Error al asignar:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});


// ==========================================================
// ENDPOINT 4: REGISTRAR VENTA (Actualizado con Validación de Inventario)
// ==========================================================
app.post('/registrar-venta', async (req, res) => {
    try {
        const { uid, pizzasVendidas, entregoPago } = req.body;
        const numPizzasVendidas = parseFloat(pizzasVendidas); // Convertimos a número

        if (!uid || !pizzasVendidas) {
            return res.status(400).json({ success: false, error: 'Faltan campos (UID, Pizzas Vendidas)' });
        }

        await doc.loadInfo();

        // --- 1. CALCULAR INVENTARIO ACTUAL ---
        
        // A. Total Asignado
        const sheetAsignaciones = doc.sheetsByTitle['Asignaciones'];
        if (!sheetAsignaciones) return res.status(500).json({ error: 'Hoja "Asignaciones" no encontrada' });
        
        const rowsAsignaciones = await sheetAsignaciones.getRows();
        let totalAsignado = 0;
        rowsAsignaciones
            .filter(row => row.get('UID_Vendedor') === uid)
            .forEach(row => {
                totalAsignado += parseFloat(row.get('Pizzas_Asignadas'));
            });

        // B. Total Vendido (Hasta ahora)
        const sheetVentas = doc.sheetsByTitle['Ventas'];
        if (!sheetVentas) return res.status(500).json({ error: 'Hoja "Ventas" no encontrada' });
        
        const rowsVentas = await sheetVentas.getRows();
        let totalVendido = 0;
        rowsVentas
            .filter(row => row.get('UID_Vendedor') === uid)
            .forEach(row => {
                totalVendido += parseFloat(row.get('Pizzas_Vendidas'));
            });

        // C. Total Devuelto
        const sheetDevoluciones = doc.sheetsByTitle['Devoluciones'];
        let totalDevuelto = 0;
        if (sheetDevoluciones) { // Si la hoja existe
            const rowsDevoluciones = await sheetDevoluciones.getRows();
            rowsDevoluciones
                .filter(row => row.get('UID_Vendedor') === uid)
                .forEach(row => {
                    totalDevuelto += parseFloat(row.get('Pizzas_Devueltas'));
                });
        }
        
        // D. El Cálculo Final
        const inventarioActual = totalAsignado - totalVendido - totalDevuelto;

        // --- 2. VALIDACIÓN ---
        if (numPizzasVendidas > inventarioActual) {
            return res.status(400).json({ 
                success: false, 
                error: `Error: No puedes vender ${numPizzasVendidas}. Inventario actual: ${inventarioActual} pizzas.` 
            });
        }
        
        // --- 3. SI LA VENTA ES VÁLIDA, PROCEDER COMO ANTES ---

        // Buscar Vendedor y su % de Comisión
        const sheetVendedores = doc.sheetsByTitle['Vendedores'];
        if (!sheetVendedores) return res.status(500).json({ error: 'Hoja "Vendedores" no encontrada' });

        const rowsVendedores = await sheetVendedores.getRows();
        const vendedorRow = rowsVendedores.find(row => row.get('UID') === uid);
        
        if (!vendedorRow) {
            return res.status(404).json({ success: false, error: 'Vendedor no encontrado' });
        }
        const nombreVendedor = vendedorRow.get('Nombre');
        const comisionPorc = parseFloat(vendedorRow.get('Comision_Venta')); // Corregido

        // Buscar el Precio Unitario (de la última asignación)
        const ultimaAsignacion = rowsAsignaciones
            .filter(row => row.get('UID_Vendedor') === uid)
            .pop(); 

        if (!ultimaAsignacion) {
            return res.status(404).json({ success: false, error: 'Este vendedor no tiene inventario asignado' });
        }
        const precioUnitario = parseFloat(ultimaAsignacion.get('Precio_Unitario'));

        // Calcular Venta Total y Comisión
        const ventaTotal = numPizzasVendidas * precioUnitario;
        const comisionGanada = ventaTotal * (comisionPorc / 100);

        // Registrar Venta
        const timestamp = new Date().toISOString();
        await sheetVentas.addRow({
            UID_Vendedor: uid,
            Nombre_Vendedor: nombreVendedor,
            Pizzas_Vendidas: numPizzasVendidas,
            Venta_Total: ventaTotal.toFixed(2),
            Comision_Ganada: comisionGanada.toFixed(2),
            Pago_Recibido: entregoPago,
            Timestamp_Venta: timestamp
        });

        return res.status(201).json({ 
            success: true, 
            message: `Venta registrada. Venta Total: $${ventaTotal.toFixed(2)}, Comisión: $${comisionGanada.toFixed(2)}` 
        });

    } catch (error) {
        console.error('Error al registrar venta:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});
// ==========================================================
// ENDPOINT 5: GENERAR REPORTE DE VENDEDOR (ACTUALIZADO)
// ==========================================================
app.get('/generar-reporte', async (req, res) => {
    try {
        const { uid } = req.query;
        if (!uid) {
            return res.status(400).json({ success: false, error: 'Se requiere un UID' });
        }

        await doc.loadInfo();

        // --- 1. Buscar Nombre del Vendedor ---
        const sheetVendedores = doc.sheetsByTitle['Vendedores'];
        if (!sheetVendedores) return res.status(500).json({ error: 'Hoja "Vendedores" no encontrada' });
        
        const rowsVendedores = await sheetVendedores.getRows();
        const vendedorRow = rowsVendedores.find(row => row.get('UID') === uid);
        
        if (!vendedorRow) {
            return res.status(404).json({ success: false, error: 'Vendedor no encontrado' });
        }
        const nombreVendedor = vendedorRow.get('Nombre');

        // --- 2. Calcular Pizzas Asignadas ---
        const sheetAsignaciones = doc.sheetsByTitle['Asignaciones'];
        if (!sheetAsignaciones) return res.status(500).json({ error: 'Hoja "Asignaciones" no encontrada' });
        
        const rowsAsignaciones = await sheetAsignaciones.getRows();
        const misAsignaciones = rowsAsignaciones.filter(row => row.get('UID_Vendedor') === uid);
        
        let totalPizzasAsignadas = 0;
        misAsignaciones.forEach(row => {
            totalPizzasAsignadas += parseFloat(row.get('Pizzas_Asignadas'));
        });

        // --- 3. Calcular Ventas, Pagos y Comisiones (de la hoja "Ventas") ---
        const sheetVentas = doc.sheetsByTitle['Ventas'];
        if (!sheetVentas) return res.status(500).json({ error: 'Hoja "Ventas" no encontrada' });
        
        const rowsVentas = await sheetVentas.getRows();
        const misVentas = rowsVentas.filter(row => row.get('UID_Vendedor') === uid);

        let totalVentaPagada = 0;
        let totalVentaPendiente = 0;
        let totalComisionesGanadas = 0;
        let totalPizzasVendidas = 0; // <-- NUEVO: Inicializamos el contador

        misVentas.forEach(row => {
            const ventaTotal = parseFloat(row.get('Venta_Total'));
            const comision = parseFloat(row.get('Comision_Ganada'));
            const pagoRecibido = row.get('Pago_Recibido');
            
            totalPizzasVendidas += parseFloat(row.get('Pizzas_Vendidas')); // <-- NUEVO: Sumamos las pizzas
            totalComisionesGanadas += comision;

            if (pagoRecibido === 'SI') {
                totalVentaPagada += ventaTotal;
            } else {
                totalVentaPendiente += ventaTotal;
            }
        });

        // --- 4. Calcular Comisiones ya Pagadas (de la hoja "Pagos_Comision") ---
        const sheetPagos = doc.sheetsByTitle['Pagos_Comision'];
        let totalComisionesPagadas = 0;
        
        if (sheetPagos) {
            const rowsPagos = await sheetPagos.getRows();
            const misPagos = rowsPagos.filter(row => row.get('UID_Vendedor') === uid);
            misPagos.forEach(row => {
                totalComisionesPagadas += parseFloat(row.get('Monto_Pagado'));
            });
        }

        // --- 5. Calcular Saldo Pendiente ---
        const comisionPendienteAPagar = totalComisionesGanadas - totalComisionesPagadas;

        // --- 6. Enviar Respuesta ---
        res.status(200).json({
            success: true,
            nombre: nombreVendedor,
            totalPizzasAsignadas: totalPizzasAsignadas,
            totalPizzasVendidas: totalPizzasVendidas, // <-- NUEVO: Enviamos el dato
            totalVentaPagada: totalVentaPagada.toFixed(2),
            totalVentaPendiente: totalVentaPendiente.toFixed(2),
            totalComisionesGanadas: totalComisionesGanadas.toFixed(2),
            totalComisionesPagadas: totalComisionesPagadas.toFixed(2),
            comisionPendienteAPagar: comisionPendienteAPagar.toFixed(2)
        });

    } catch (error) {
        console.error('Error al generar reporte:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});
// ==========================================================
// ENDPOINT 6: REGISTRAR PAGO DE COMISIÓN (SIMPLIFICADO)
// ==========================================================
app.post('/pagar-comision', async (req, res) => {
    try {
        // CAMBIO 1: Ya no recibimos 'firmaBase64'
        const { uid, montoPagado, nombre } = req.body;
        
        if (!uid || !montoPagado || !nombre) {
            return res.status(400).json({ success: false, error: 'Faltan datos (UID, Monto, Nombre)' });
        }
        
        // CAMBIO 2: Validación de la firma eliminada
        // if (!firmaBase64) {
        //     return res.status(400).json({ success: false, error: 'Falta la firma' });
        // }

        await doc.loadInfo();

        const sheetPagos = doc.sheetsByTitle['Pagos_Comision'];
        if (!sheetPagos) {
            return res.status(500).json({ success: false, error: 'Hoja "Pagos_Comision" no encontrada' });
        }

        // CAMBIO 3: Añadimos la fila SIN la firma
        await sheetPagos.addRow({
            UID_Vendedor: uid,
            Nombre_Vendedor: nombre,
            Monto_Pagado: montoPagado,
            Timestamp_Pago: new Date().toISOString()
            // Firma_Base64: firmaBase64 // <-- ¡Línea eliminada!
        });

        console.log(`Pago de comisión registrado para ${nombre}: $${montoPagado} (Sin firma)`);
        return res.status(201).json({ success: true, message: 'Pago de comisión registrado (sin firma)' });

    } catch (error) {
        console.error('Error al pagar comisión:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});
// ==========================================================
// ENDPOINT 7: REGISTRAR DEVOLUCIÓN
// ==========================================================
app.post('/registrar-devolucion', async (req, res) => {
    try {
        const { uid, pizzasDevueltas } = req.body;
        if (!uid || !pizzasDevueltas) {
            return res.status(400).json({ success: false, error: 'Faltan campos (UID, Pizzas)' });
        }

        await doc.loadInfo();

        // 1. Buscar Nombre del Vendedor
        const sheetVendedores = doc.sheetsByTitle['Vendedores'];
        if (!sheetVendedores) return res.status(500).json({ error: 'Hoja "Vendedores" no encontrada' });
        
        const rowsVendedores = await sheetVendedores.getRows();
        const vendedorRow = rowsVendedores.find(row => row.get('UID') === uid);
        
        if (!vendedorRow) {
            return res.status(404).json({ success: false, error: 'Vendedor no encontrado' });
        }
        const nombreVendedor = vendedorRow.get('Nombre');

        // 2. Registrar Devolución en la hoja "Devoluciones"
        const sheetDevoluciones = doc.sheetsByTitle['Devoluciones'];
        if (!sheetDevoluciones) return res.status(500).json({ error: 'Hoja "Devoluciones" no encontrada' });

        await sheetDevoluciones.addRow({
            UID_Vendedor: uid,
            Nombre_Vendedor: nombreVendedor,
            Pizzas_Devueltas: pizzasDevueltas,
            Timestamp_Devolucion: new Date().toISOString()
        });

        return res.status(201).json({ success: true, message: 'Devolución registrada exitosamente' });

    } catch (error) {
        console.error('Error al registrar devolución:', error);
        return res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});