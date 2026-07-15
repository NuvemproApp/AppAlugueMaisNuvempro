import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Text,
  Title,
  Button,
  Badge,
  Modal,
  Table,
  Select,
  Input,
  Toggle,
  Breadcrumb,
  Spinner,
  Alert,
  Thumbnail,
} from '@nimbus-ds/components';
import api from '../services/api.js';

// ─── Dropdown de ações ────────────────────────────────────────────────────────
function ActionsMenu({ onEdit, onDelete, labelEdit, labelDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <Box ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <Button size="small" appearance="neutral" onClick={() => setOpen((v) => !v)}>
        {labelDelete ? '•••' : 'Ações'} ▾
      </Button>
      {open && (
        <Box
          backgroundColor="neutral-background"
          borderColor="neutral-surfaceHighlight"
          borderStyle="solid"
          borderWidth="1"
          borderRadius="2"
          style={{
            position: 'absolute',
            right: 0,
            top: '110%',
            zIndex: 50,
            minWidth: 130,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          <Box display="flex" flexDirection="column" padding="1" gap="1">
            <Button
              appearance="transparent"
              size="small"
              onClick={() => { onEdit(); setOpen(false); }}
            >
              {labelEdit}
            </Button>
            <Button
              appearance="transparent"
              size="small"
              onClick={() => { onDelete(); setOpen(false); }}
            >
              <Text color="danger-interactive">{labelDelete}</Text>
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── Formulário dentro do modal ───────────────────────────────────────────────
const EMPTY_FORM = {
  productId: '',
  status: 1,
  diasAntes: 0,
  diasDepois: 0,
  estoque: 1,
};

export default function ProductsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = criando, objeto = editando
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [nsProducts, setNsProducts] = useState([]); // produtos NS disponíveis para o select
  const [nsLoading, setNsLoading] = useState(false);

  // ─── Carrega lista de produtos alugáveis ──────────────────────────────────
  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/products');
      setProducts(data.products || []);
    } catch {
      setError(t('products.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // ─── Abre modal de criação ────────────────────────────────────────────────
  async function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
    setNsLoading(true);
    try {
      const { data } = await api.get('/api/products/nuvemshop');
      setNsProducts(data.products || []);
    } catch {
      setNsProducts([]);
    } finally {
      setNsLoading(false);
    }
  }

  // ─── Abre modal de edição ─────────────────────────────────────────────────
  function openEdit(product) {
    setEditing(product);
    setForm({
      productId: product.productId,
      status: product.status,
      diasAntes: product.diasAntes,
      diasDepois: product.diasDepois,
      estoque: product.estoque,
    });
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setFormError('');
  }

  // ─── Salva (criar ou atualizar) ───────────────────────────────────────────
  async function handleSave() {
    if (!editing && !form.productId) {
      setFormError(t('products.errorNoProduct'));
      return;
    }
    if (form.estoque < 1) {
      setFormError(t('products.errorStock'));
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await api.patch(`/api/products/${editing.id}`, {
          status: form.status,
          diasAntes: form.diasAntes,
          diasDepois: form.diasDepois,
          estoque: form.estoque,
        });
      } else {
        await api.post('/api/products', form);
      }
      closeModal();
      await loadProducts();
    } catch (err) {
      const msg = err?.response?.data?.error || t('products.errorSave');
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  }

  // ─── Remove produto alugável ──────────────────────────────────────────────
  async function handleDelete(id) {
    if (!window.confirm(t('products.confirmDelete'))) return;
    try {
      await api.delete(`/api/products/${id}`);
      await loadProducts();
    } catch {
      alert(t('products.errorDelete'));
    }
  }

  // ─── Helpers de idioma ────────────────────────────────────────────────────
  function getProductName(p) {
    return p.nuvemshopName || p.productId;
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Box display="flex" flexDirection="column" gap="6" padding="6">

      {/* Breadcrumb */}
      <Breadcrumb>
        <Breadcrumb.Item onClick={() => navigate('/')}>{t('nav.dashboard')}</Breadcrumb.Item>
        <Breadcrumb.Item>{t('products.title')}</Breadcrumb.Item>
      </Breadcrumb>

      {/* Cabeçalho */}
      <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="3">
        <Title as="h2">{t('products.heading')}</Title>
        <Box display="flex" gap="2">
          <Button appearance="neutral" onClick={() => navigate('/alugueis')}>
            {t('products.navRentals')}
          </Button>
          <Button appearance="primary" onClick={openCreate}>
            {t('products.addProduct')}
          </Button>
        </Box>
      </Box>

      {/* Estado de erro global */}
      {error && (
        <Alert appearance="danger">
          <Text>{error}</Text>
        </Alert>
      )}

      {/* Estado de carregamento */}
      {loading ? (
        <Box display="flex" justifyContent="center" padding="8">
          <Spinner size="large" />
        </Box>
      ) : products.length === 0 ? (
        <Box
          padding="8"
          display="flex"
          flexDirection="column"
          alignItems="center"
          gap="3"
          borderColor="neutral-surfaceHighlight"
          borderStyle="dashed"
          borderWidth="1"
          borderRadius="2"
        >
          <Text color="neutral-textLow">{t('products.empty')}</Text>
          <Button appearance="primary" onClick={openCreate}>
            {t('products.addProduct')}
          </Button>
        </Box>
      ) : (
        /* Tabela */
        <Box style={{ overflowX: 'auto' }}>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Cell as="th">{t('products.colProduct')}</Table.Cell>
                <Table.Cell as="th">{t('products.colQtyRented')}</Table.Cell>
                <Table.Cell as="th">{t('products.colStatus')}</Table.Cell>
                <Table.Cell as="th">{t('products.colStock')}</Table.Cell>
                <Table.Cell as="th">{t('products.colActions')}</Table.Cell>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {products.map((p) => (
                <Table.Row key={p.id}>
                  {/* Produto */}
                  <Table.Cell>
                    <Box display="flex" gap="3" alignItems="center">
                      {p.nuvemshopImage ? (
                        <Thumbnail
                          src={p.nuvemshopImage}
                          alt={getProductName(p)}
                          width="48px"
                          aspectRatio="1/1"
                        />
                      ) : (
                        <Box
                          width="48px"
                          backgroundColor="neutral-surfaceHighlight"
                          borderRadius="2"
                          style={{ height: 48, flexShrink: 0 }}
                        />
                      )}
                      <Box display="flex" flexDirection="column" gap="1">
                        <Text fontWeight="bold" fontSize="base">
                          {getProductName(p)}
                        </Text>
                        <Text fontSize="caption" color="neutral-textLow">
                          {t('products.daysBefore', { count: p.diasAntes })}
                        </Text>
                        <Text fontSize="caption" color="neutral-textLow">
                          {t('products.daysAfter', { count: p.diasDepois })}
                        </Text>
                      </Box>
                    </Box>
                  </Table.Cell>

                  {/* Qtde. Alugada — vazio por ora */}
                  <Table.Cell>
                    <Text color="neutral-textDisabled">—</Text>
                  </Table.Cell>

                  {/* Situação */}
                  <Table.Cell>
                    <Badge
                      appearance={p.status === 1 ? 'success' : 'neutral'}
                    >
                      {p.status === 1 ? t('products.statusActive') : t('products.statusInactive')}
                    </Badge>
                  </Table.Cell>

                  {/* Estoque */}
                  <Table.Cell>
                    <Text>{p.estoque}</Text>
                  </Table.Cell>

                  {/* Ações */}
                  <Table.Cell>
                    <ActionsMenu
                      labelEdit={t('products.actionEdit')}
                      labelDelete={t('products.actionDelete')}
                      onEdit={() => openEdit(p)}
                      onDelete={() => handleDelete(p.id)}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Box>
      )}

      {/* Modal Add/Edit */}
      <Modal open={modalOpen} onDismiss={closeModal}>
        <Modal.Header
          title={editing ? t('products.modalEditTitle') : t('products.modalAddTitle')}
        />
        <Modal.Body padding="base">
          <Box display="flex" flexDirection="column" gap="4">

            {formError && (
              <Alert appearance="danger">
                <Text>{formError}</Text>
              </Alert>
            )}

            {/* Seleção do produto (somente na criação) */}
            {!editing && (
              <Box display="flex" flexDirection="column" gap="1">
                <Text as="label" htmlFor="productId" fontWeight="bold" fontSize="caption">
                  {t('products.fieldProduct')}
                </Text>
                {nsLoading ? (
                  <Box display="flex" alignItems="center" gap="2">
                    <Spinner size="small" />
                    <Text fontSize="caption" color="neutral-textLow">
                      {t('products.loadingProducts')}
                    </Text>
                  </Box>
                ) : (
                  <Select
                    id="productId"
                    value={form.productId}
                    onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                  >
                    <option value="">{t('products.selectProduct')}</option>
                    {nsProducts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                )}
                {nsProducts.length === 0 && !nsLoading && (
                  <Text fontSize="caption" color="neutral-textLow">
                    {t('products.noProductsAvailable')}
                  </Text>
                )}
              </Box>
            )}

            {/* Estoque */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="estoque" fontWeight="bold" fontSize="caption">
                {t('products.fieldStock')}
              </Text>
              <Input
                id="estoque"
                type="number"
                min="1"
                value={String(form.estoque)}
                onChange={(e) => setForm((f) => ({ ...f, estoque: Number(e.target.value) }))}
              />
            </Box>

            {/* Dias de antecedência */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="diasAntes" fontWeight="bold" fontSize="caption">
                {t('products.fieldDaysBefore')}
              </Text>
              <Input
                id="diasAntes"
                type="number"
                min="0"
                value={String(form.diasAntes)}
                onChange={(e) => setForm((f) => ({ ...f, diasAntes: Number(e.target.value) }))}
              />
              <Text fontSize="caption" color="neutral-textLow">
                {t('products.fieldDaysBeforeHint')}
              </Text>
            </Box>

            {/* Dias de bloqueio após */}
            <Box display="flex" flexDirection="column" gap="1">
              <Text as="label" htmlFor="diasDepois" fontWeight="bold" fontSize="caption">
                {t('products.fieldDaysAfter')}
              </Text>
              <Input
                id="diasDepois"
                type="number"
                min="0"
                value={String(form.diasDepois)}
                onChange={(e) => setForm((f) => ({ ...f, diasDepois: Number(e.target.value) }))}
              />
              <Text fontSize="caption" color="neutral-textLow">
                {t('products.fieldDaysAfterHint')}
              </Text>
            </Box>

            {/* Status */}
            <Box display="flex" alignItems="center" gap="3">
              <Toggle
                name="status"
                id="status"
                checked={form.status === 1}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.checked ? 1 : 0 }))}
                label={form.status === 1 ? t('products.statusActive') : t('products.statusInactive')}
              />
            </Box>

          </Box>
        </Modal.Body>
        <Modal.Footer>
          <Box display="flex" gap="2" justifyContent="flex-end">
            <Button appearance="neutral" onClick={closeModal} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size="small" /> : t('common.save')}
            </Button>
          </Box>
        </Modal.Footer>
      </Modal>

    </Box>
  );
}
