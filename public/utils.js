/**
 * Convierte un UID Hex Big-Endian (del celular) 
 * al formato Decimal Little-Endian (del lector USB).
 * @param {string} uidHex - El UID en formato Hex, ej. "128F8005"
 * @returns {string} - El UID en formato decimal de 10 dígitos, ej. "0092311314"
 */
function convertirUid(uidHex) {
    try {
        // 1. Separa el string "128F8005" en un array de bytes: ['12', '8F', '80', '05']
        const bytes = uidHex.match(/.{1,2}/g); 
        
        // 2. Invierte el array: ['05', '80', '8F', '12']
        const bytesInvertidos = bytes.reverse();
        
        // 3. Une el array en un nuevo string: "05808F12"
        const hexInvertido = bytesInvertidos.join('');
        
        // 4. Convierte el Hex invertido a Decimal: 92311314
        const decimal = parseInt(hexInvertido, 16);
        
        // 5. Rellena con ceros a 10 dígitos y lo convierte a string: "0092311314"
        return String(decimal).padStart(10, '0');
        
    } catch (error) {
        // Si algo falla (ej. un UID de longitud rara), solo devuelve el original
        console.error("Error convirtiendo UID:", error);
        return uidHex; 
    }
}